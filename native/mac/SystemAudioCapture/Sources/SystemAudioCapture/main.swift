import Foundation
import AVFoundation
import AudioToolbox
import CoreAudio
import ScreenCaptureKit

let requestedSampleRate = 24_000
let requestedChannels = 1

func writeStatus(_ json: String) {
    FileHandle.standardError.write((json + "\n").data(using: .utf8)!)
}

func sanitized(_ value: String) -> String {
    value.replacingOccurrences(of: "\"", with: "'")
}

@available(macOS 13.0, *)
final class AudioDumper: NSObject {
    private var stream: SCStream?
    private var output: StreamOutput?
    // ScreenCaptureKit does not promise FIFO delivery when callbacks share a
    // concurrent global queue. The capture protocol assigns each audio buffer
    // a strictly increasing sequence and interval, so serialize audio at the
    // source instead of trying to repair genuinely reordered buffers later.
    private let audioSampleQueue = DispatchQueue(
        label: "ai.taylos.system-audio.capture",
        qos: .userInitiated
    )
    private let screenSampleQueue = DispatchQueue(
        label: "ai.taylos.system-video.discard",
        qos: .utility
    )

    func start() async throws {
        writeStatus("{\"status\":\"starting\",\"message\":\"Requesting screen recording permissions\"}")

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
            writeStatus("{\"status\":\"permission_granted\"}")
        } catch {
            writeStatus(
                "{\"status\":\"permission_error\",\"code\":\"screen_recording_permission_denied\",\"error\":\"\(sanitized(String(describing: error)))\"}"
            )
            throw error
        }

        guard let display = content.displays.first else {
            writeStatus("{\"status\":\"capture_error\",\"code\":\"no_display\",\"error\":\"No display found\"}")
            throw NSError(
                domain: "SystemAudioCapture",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "No display found"]
            )
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = false
        configuration.sampleRate = requestedSampleRate
        configuration.channelCount = requestedChannels
        configuration.width = display.width
        configuration.height = display.height

        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        let output = StreamOutput()
        self.stream = stream
        self.output = output

        try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: audioSampleQueue)
        // Keeping a no-op screen output attached avoids missing audio callbacks
        // on affected macOS builds. Screen frames are discarded.
        try? stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: screenSampleQueue)

        do {
            try await stream.startCapture()
            writeStatus(
                "{\"status\":\"capture_started\",\"protocol\":\"ndjson-float32-v1\",\"sample_rate\":\(requestedSampleRate),\"channels\":\(requestedChannels)}"
            )
        } catch {
            writeStatus(
                "{\"status\":\"capture_error\",\"code\":\"screen_capture_start_failed\",\"error\":\"\(sanitized(String(describing: error)))\"}"
            )
            throw error
        }

        while true {
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    private final class StreamOutput: NSObject, SCStreamOutput {
        private var emittedFirstChunk = false

        func stream(
            _ stream: SCStream,
            didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
            of type: SCStreamOutputType
        ) {
            guard type == .audio,
                  let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer),
                  let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
                  let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)?.pointee
            else {
                return
            }

            let byteCount = CMBlockBufferGetDataLength(blockBuffer)
            guard byteCount > 0 else { return }

            var data = Data(count: byteCount)
            data.withUnsafeMutableBytes { pointer in
                guard let destination = pointer.baseAddress else { return }
                _ = CMBlockBufferCopyDataBytes(
                    blockBuffer,
                    atOffset: 0,
                    dataLength: byteCount,
                    destination: destination
                )
            }

            let channels = max(1, Int(asbd.mChannelsPerFrame))
            let mimeType = "audio/float32;rate=\(Int(asbd.mSampleRate));channels=\(channels)"
            var payload: [String: Any] = [
                "data": data.base64EncodedString(),
                "mimeType": mimeType,
            ]

            // ScreenCaptureKit timestamps the first sample in each buffer on
            // the host clock. Convert that to Unix time here, while both the
            // presentation timestamp and host time are available in the same
            // process. Electron can then account for helper and IPC latency
            // instead of guessing one fixed delay for the whole session.
            let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            let hostTime = CMClockGetTime(CMClockGetHostTimeClock())
            if presentationTime.isValid,
               presentationTime.isNumeric,
               hostTime.isValid,
               hostTime.isNumeric,
               presentationTime.epoch == hostTime.epoch {
                let captureAgeSeconds = CMTimeGetSeconds(CMTimeSubtract(hostTime, presentationTime))
                if captureAgeSeconds.isFinite,
                   captureAgeSeconds >= 0,
                   captureAgeSeconds <= 5 {
                    payload["capturedAtUnixMs"] =
                        Date().timeIntervalSince1970 * 1000 - captureAgeSeconds * 1000
                }
            }
            guard let jsonData = try? JSONSerialization.data(withJSONObject: payload) else { return }
            FileHandle.standardOutput.write(jsonData)
            FileHandle.standardOutput.write("\n".data(using: .utf8)!)

            if !emittedFirstChunk {
                emittedFirstChunk = true
                writeStatus(
                    "{\"status\":\"first_audio_chunk\",\"bytes\":\(byteCount),\"sample_rate\":\(Int(asbd.mSampleRate)),\"channels\":\(channels)}"
                )
            }
        }
    }
}


// MARK: - Shared frame emission (ndjson-float32-v1)

/// Writes one interleaved float32 buffer as an NDJSON frame on stdout, the
/// same protocol the ScreenCaptureKit path speaks, so Electron does not care
/// which backend produced the audio.
func emitFrame(interleaved data: Data, sampleRate: Int, channels: Int, capturedAtUnixMs: Double?) {
    var payload: [String: Any] = [
        "data": data.base64EncodedString(),
        "mimeType": "audio/float32;rate=\(sampleRate);channels=\(channels)",
    ]
    if let capturedAtUnixMs { payload["capturedAtUnixMs"] = capturedAtUnixMs }
    guard let jsonData = try? JSONSerialization.data(withJSONObject: payload) else { return }
    FileHandle.standardOutput.write(jsonData)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

/// mach_absolute_time → seconds.
enum HostClock {
    static let secondsPerTick: Double = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return Double(info.numer) / Double(info.denom) / 1_000_000_000
    }()
    static func seconds(_ hostTime: UInt64) -> Double { Double(hostTime) * secondsPerTick }
}

// MARK: - System audio recording permission (kTCCServiceAudioCapture)

/// The tap prompts the first time audio flows through an aggregate device that
/// contains it, and a denial yields silence rather than an error. The TCC SPI
/// is the only way to know beforehand; when it is unavailable we report
/// "unknown" and the caller falls back to prompting by starting capture.
enum AudioCapturePermission {
    private typealias PreflightFn = @convention(c) (CFString, CFDictionary?) -> Int
    private typealias RequestFn = @convention(c) (CFString, CFDictionary?, @escaping (Bool) -> Void) -> Void
    private static let handle: UnsafeMutableRawPointer? = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW)
    private static let preflight: PreflightFn? = {
        guard let handle, let symbol = dlsym(handle, "TCCAccessPreflight") else { return nil }
        return unsafeBitCast(symbol, to: PreflightFn.self)
    }()
    private static let request: RequestFn? = {
        guard let handle, let symbol = dlsym(handle, "TCCAccessRequest") else { return nil }
        return unsafeBitCast(symbol, to: RequestFn.self)
    }()

    /// "authorized", "denied" or "unknown" (not yet decided, or SPI missing).
    static func status() -> String {
        guard let preflight else { return "unknown" }
        switch preflight("kTCCServiceAudioCapture" as CFString, nil) {
        case 0: return "authorized"
        case 1: return "denied"
        default: return "unknown"
        }
    }

    /// Shows the system prompt if the decision is still open; resolves with the outcome.
    static func requestAccess(completion: @escaping (Bool) -> Void) {
        guard let request else { completion(false); return }
        request("kTCCServiceAudioCapture" as CFString, nil, completion)
    }
}

// MARK: - Core Audio process tap (macOS 14.4+): "System Audio Recording Only"

/// Captures every process's output through a global tap on an aggregate
/// device. Runs under the narrower "System Audio Recording Only" permission -
/// no screen contents, no System Settings detour, none of Sequoia's recurring
/// screen-recording re-approval.
@available(macOS 14.4, *)
final class TapDumper {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private var format: AVAudioFormat?
    private var emittedFirstChunk = false
    private let queue = DispatchQueue(label: "ai.taylos.system-audio.tap", qos: .userInitiated)

    func start() throws {
        writeStatus("{\"status\":\"starting\",\"message\":\"Requesting system audio recording permission\",\"backend\":\"core-audio-tap\"}")

        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.name = "Taylos system audio"
        description.isPrivate = true
        description.muteBehavior = .unmuted

        var tap = AudioObjectID(kAudioObjectUnknown)
        var err = AudioHardwareCreateProcessTap(description, &tap)
        guard err == noErr, tap != kAudioObjectUnknown else {
            writeStatus("{\"status\":\"capture_error\",\"code\":\"tap_create_failed\",\"error\":\"AudioHardwareCreateProcessTap \(err)\"}")
            throw NSError(domain: "SystemAudioCapture", code: Int(err), userInfo: nil)
        }
        tapID = tap

        var streamDescription = try readTapFormat(tap)
        let outputUID = try readDefaultSystemOutputUID()
        let aggregateDescription: [String: Any] = [
            kAudioAggregateDeviceNameKey as String: "Taylos system audio",
            kAudioAggregateDeviceUIDKey as String: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey as String: outputUID,
            kAudioAggregateDeviceIsPrivateKey as String: true,
            kAudioAggregateDeviceIsStackedKey as String: false,
            kAudioAggregateDeviceTapAutoStartKey as String: true,
            kAudioAggregateDeviceSubDeviceListKey as String: [[kAudioSubDeviceUIDKey as String: outputUID]],
            kAudioAggregateDeviceTapListKey as String: [[
                kAudioSubTapDriftCompensationKey as String: true,
                kAudioSubTapUIDKey as String: description.uuid.uuidString,
            ]],
        ]
        err = AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateID)
        guard err == noErr, aggregateID != kAudioObjectUnknown else {
            writeStatus("{\"status\":\"capture_error\",\"code\":\"aggregate_create_failed\",\"error\":\"AudioHardwareCreateAggregateDevice \(err)\"}")
            throw NSError(domain: "SystemAudioCapture", code: Int(err), userInfo: nil)
        }

        guard let format = AVAudioFormat(streamDescription: &streamDescription) else {
            writeStatus("{\"status\":\"capture_error\",\"code\":\"tap_format_invalid\",\"error\":\"tap stream description not usable\"}")
            throw NSError(domain: "SystemAudioCapture", code: 2, userInfo: nil)
        }
        self.format = format

        err = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, queue) { [weak self] _, inInputData, inInputTime, _, _ in
            self?.handle(inInputData, inputTime: inInputTime)
        }
        guard err == noErr else {
            writeStatus("{\"status\":\"capture_error\",\"code\":\"tap_ioproc_failed\",\"error\":\"AudioDeviceCreateIOProcIDWithBlock \(err)\"}")
            throw NSError(domain: "SystemAudioCapture", code: Int(err), userInfo: nil)
        }

        // The first start of an aggregate device that contains a tap is what
        // shows the permission prompt.
        err = AudioDeviceStart(aggregateID, ioProcID)
        guard err == noErr else {
            writeStatus("{\"status\":\"capture_error\",\"code\":\"tap_start_failed\",\"error\":\"AudioDeviceStart \(err)\"}")
            throw NSError(domain: "SystemAudioCapture", code: Int(err), userInfo: nil)
        }
        let permission = AudioCapturePermission.status()
        if permission == "denied" {
            writeStatus("{\"status\":\"permission_error\",\"code\":\"system_audio_permission_denied\",\"error\":\"System Audio Recording permission denied\"}")
            throw NSError(domain: "SystemAudioCapture", code: 3, userInfo: nil)
        }
        writeStatus("{\"status\":\"permission_granted\",\"permission\":\"\(permission)\"}")
        writeStatus(
            "{\"status\":\"capture_started\",\"protocol\":\"ndjson-float32-v1\",\"backend\":\"core-audio-tap\",\"sample_rate\":\(Int(format.sampleRate)),\"channels\":\(Int(format.channelCount))}"
        )
    }

    func run() async {
        while true {
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    private func handle(_ list: UnsafePointer<AudioBufferList>, inputTime: UnsafePointer<AudioTimeStamp>) {
        guard let format else { return }
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: list))
        let channels = Int(format.channelCount)
        guard channels > 0, let first = buffers.first, let base = first.mData else { return }
        let sampleRate = Int(format.sampleRate)
        var data: Data
        if format.isInterleaved || buffers.count == 1 {
            let byteCount = Int(first.mDataByteSize)
            guard byteCount > 0 else { return }
            data = Data(bytes: base, count: byteCount)
        } else {
            // One buffer per channel: interleave so the protocol stays one shape.
            let frames = Int(first.mDataByteSize) / MemoryLayout<Float>.size
            guard frames > 0 else { return }
            var interleaved = [Float](repeating: 0, count: frames * channels)
            for (channel, buffer) in buffers.enumerated() where channel < channels {
                guard let pointer = buffer.mData?.assumingMemoryBound(to: Float.self) else { continue }
                let available = min(frames, Int(buffer.mDataByteSize) / MemoryLayout<Float>.size)
                for frame in 0..<available { interleaved[frame * channels + channel] = pointer[frame] }
            }
            data = interleaved.withUnsafeBufferPointer { Data(buffer: $0) }
        }
        var capturedAt: Double? = nil
        let stamp = inputTime.pointee
        if stamp.mFlags.contains(.hostTimeValid) {
            let age = HostClock.seconds(mach_absolute_time()) - HostClock.seconds(stamp.mHostTime)
            if age.isFinite, age >= 0, age <= 5 { capturedAt = Date().timeIntervalSince1970 * 1000 - age * 1000 }
        }
        emitFrame(interleaved: data, sampleRate: sampleRate, channels: channels, capturedAtUnixMs: capturedAt)
        if !emittedFirstChunk {
            emittedFirstChunk = true
            writeStatus("{\"status\":\"first_audio_chunk\",\"bytes\":\(data.count),\"sample_rate\":\(sampleRate),\"channels\":\(channels)}")
        }
    }

    private func readTapFormat(_ tap: AudioObjectID) throws -> AudioStreamBasicDescription {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var description = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let err = AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &description)
        guard err == noErr else {
            writeStatus("{\"status\":\"capture_error\",\"code\":\"tap_format_failed\",\"error\":\"kAudioTapPropertyFormat \(err)\"}")
            throw NSError(domain: "SystemAudioCapture", code: Int(err), userInfo: nil)
        }
        return description
    }

    private func readDefaultSystemOutputUID() throws -> String {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var device = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var err = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
        guard err == noErr, device != kAudioObjectUnknown else {
            writeStatus("{\"status\":\"capture_error\",\"code\":\"no_output_device\",\"error\":\"default system output device \(err)\"}")
            throw NSError(domain: "SystemAudioCapture", code: Int(err), userInfo: nil)
        }
        address.mSelector = kAudioDevicePropertyDeviceUID
        var uid: CFString = "" as CFString
        size = UInt32(MemoryLayout<CFString>.size)
        err = withUnsafeMutablePointer(to: &uid) { pointer in
            AudioObjectGetPropertyData(device, &address, 0, nil, &size, pointer)
        }
        guard err == noErr else {
            writeStatus("{\"status\":\"capture_error\",\"code\":\"output_uid_failed\",\"error\":\"kAudioDevicePropertyDeviceUID \(err)\"}")
            throw NSError(domain: "SystemAudioCapture", code: Int(err), userInfo: nil)
        }
        return uid as String
    }
}

/// Which backend this machine gets: the tap from macOS 14.4, ScreenCaptureKit
/// below it. TAYLOS_SYSTEM_AUDIO_BACKEND=screencapturekit|tap overrides.
func selectedBackend() -> String {
    let forced = ProcessInfo.processInfo.environment["TAYLOS_SYSTEM_AUDIO_BACKEND"]?.lowercased()
    if forced == "screencapturekit" || forced == "sck" { return "screencapturekit" }
    if #available(macOS 14.4, *) { return forced == "tap" || forced == nil ? "tap" : forced! }
    return "screencapturekit"
}

@main
struct Main {
    static func main() async {
        let arguments = CommandLine.arguments.dropFirst()
        // Permission modes exit immediately; Electron uses them for the
        // onboarding checklist before any capture starts.
        if arguments.contains("--audio-permission-status") {
            let tapAvailable: Bool
            if #available(macOS 14.4, *) { tapAvailable = selectedBackend() == "tap" } else { tapAvailable = false }
            writeStatus("{\"status\":\"audio_capture_permission\",\"state\":\"\(AudioCapturePermission.status())\",\"tap\":\(tapAvailable)}")
            exit(0)
        }
        if arguments.contains("--request-audio-permission") {
            let granted: Bool = await withCheckedContinuation { continuation in
                AudioCapturePermission.requestAccess { continuation.resume(returning: $0) }
            }
            writeStatus("{\"status\":\"audio_capture_permission\",\"state\":\"\(granted ? "authorized" : AudioCapturePermission.status())\",\"requested\":true}")
            exit(0)
        }

        writeStatus("{\"status\":\"helper_starting\",\"version\":\"1.2\",\"backend\":\"\(selectedBackend())\"}")
        writeStatus(
            "{\"status\":\"os_version\",\"current\":\"\(sanitized(ProcessInfo.processInfo.operatingSystemVersionString))\"}"
        )

        if #available(macOS 14.4, *), selectedBackend() == "tap" {
            do {
                let dumper = TapDumper()
                try dumper.start()
                await dumper.run()
            } catch {
                writeStatus(
                    "{\"status\":\"fatal_error\",\"code\":\"capture_failed\",\"error\":\"\(sanitized(String(describing: error)))\"}"
                )
                exit(1)
            }
        } else if #available(macOS 13.0, *) {
            do {
                try await AudioDumper().start()
            } catch {
                writeStatus(
                    "{\"status\":\"fatal_error\",\"code\":\"capture_failed\",\"error\":\"\(sanitized(String(describing: error)))\"}"
                )
                exit(1)
            }
        } else {
            writeStatus(
                "{\"status\":\"unsupported_os\",\"code\":\"macos_system_audio_requires_13\",\"minimum\":\"13.0\",\"current\":\"\(sanitized(ProcessInfo.processInfo.operatingSystemVersionString))\"}"
            )
            exit(1)
        }
    }
}
