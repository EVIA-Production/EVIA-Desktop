import Foundation
import AVFoundation
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

@main
struct Main {
    static func main() async {
        writeStatus("{\"status\":\"helper_starting\",\"version\":\"1.1\"}")
        writeStatus(
            "{\"status\":\"os_version\",\"current\":\"\(sanitized(ProcessInfo.processInfo.operatingSystemVersionString))\"}"
        )

        if #available(macOS 13.0, *) {
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
