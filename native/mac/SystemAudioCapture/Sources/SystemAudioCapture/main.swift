import Foundation
import AVFoundation
import ScreenCaptureKit
import AudioToolbox

// Config (dst)
let sampleRate: Double = 24000 // Align to Glass
let frameDurationSec: Double = 0.1 // 100 ms
let channels: AVAudioChannelCount = 1

// Print version info function
func printVersionInfo() {
    FileHandle.standardError.write("SystemAudioCapture v1.0 starting\n".data(using: .utf8)!)
    FileHandle.standardError.write("macOS version: \(ProcessInfo.processInfo.operatingSystemVersionString)\n".data(using: .utf8)!)
}

@available(macOS 13.0, *)
final class AudioDumper: NSObject {
    private var stream: SCStream?
    private var output: SCStreamOutput?
    private var audioConverter: AVAudioConverter?
    private var dstFormat: AVAudioFormat
    private let dstFrameCapacity: AVAudioFrameCount
    // Stats & debug dump
    private var totalFrames: Int = 0
    private var totalBytes: Int = 0
    private var totalChunks: Int = 0
    private var lastStatsTs: TimeInterval = Date().timeIntervalSince1970
    private var wavBuffer = Data()
    private let wavMaxSeconds: Double = 5.0
    private var srcWavBuffer = Data()
    private let srcWavMaxSeconds: Double = 5.0

    override init() {
        self.dstFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: channels, interleaved: true)!
        self.dstFrameCapacity = AVAudioFrameCount(sampleRate * frameDurationSec)
        super.init()
    }

    func start() async throws {
        // Explicitly log that we're starting the permission request
        let startingMsg = "{\"status\":\"starting\",\"message\":\"Requesting screen recording permissions...\"}\n"
        FileHandle.standardError.write(startingMsg.data(using: .utf8)!)
        
        // Request capture permission explicitly with better error handling
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            
            // Log success
            let permissionMsg = "{\"status\":\"permission_granted\",\"message\":\"Screen recording permission granted\"}\n"
            FileHandle.standardError.write(permissionMsg.data(using: .utf8)!)
        } catch {
            // Log detailed permission error
            let errorMsg = "{\"status\":\"permission_error\",\"error\":\"\(String(describing: error).replacingOccurrences(of: "\"", with: "'"))\"}\n"
            FileHandle.standardError.write(errorMsg.data(using: .utf8)!)
            throw error
        }
        
        guard let display = content.displays.first else {
            let noDisplayMsg = "{\"status\":\"error\",\"error\":\"No display found\"}\n"
            FileHandle.standardError.write(noDisplayMsg.data(using: .utf8)!)
            throw NSError(domain: "SystemAudioCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display found"])
        }
        
        // Log display info
        let displayMsg = "{\"status\":\"display_found\",\"display_id\":\(display.displayID),\"width\":\(display.width),\"height\":\(display.height)}\n"
        FileHandle.standardError.write(displayMsg.data(using: .utf8)!)

        // Configure stream for audio (request typical 48k/2ch from SC) and enable video to encourage buffer delivery
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = false
        config.sampleRate = 24000 // Glass rate
        config.channelCount = 1   // Mono for simplicity
        config.width = display.width
        config.height = display.height

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        self.stream = stream

        let output = StreamOutput(format: dstFormat, frameCapacity: dstFrameCapacity, parent: self)
        self.output = output
        try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: .global())
        // Some environments require a screen output attached for audio delivery; attach the same output (no-op for .screen in our handler)
        try? stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: .global())

        let outputAddedMsg = "{\"status\":\"output_added\"}\n"
        FileHandle.standardError.write(outputAddedMsg.data(using: .utf8)!)

        // Log that we're about to start capture
        let startCaptureMsg = "{\"status\":\"starting_capture\",\"message\":\"Starting audio capture stream\"}\n"
        FileHandle.standardError.write(startCaptureMsg.data(using: .utf8)!)
        
        do {
            try await stream.startCapture()
            
            // Log successful capture start
            let captureStartedMsg = "{\"status\":\"capture_started\",\"message\":\"Audio capture stream started successfully\"}\n"
            FileHandle.standardError.write(captureStartedMsg.data(using: .utf8)!)
        } catch {
            // Log capture start error
            let errorStr = String(describing: error).replacingOccurrences(of: "\"", with: "'")
            let captureErrorMsg = "{\"status\":\"capture_error\",\"error\":\"\(errorStr)\"}\n"
            FileHandle.standardError.write(captureErrorMsg.data(using: .utf8)!)
            throw error
        }

        // Keep running
        // Keep process alive
        let runningMsg = "{\"status\":\"running\",\"message\":\"Audio capture running\"}\n"
        FileHandle.standardError.write(runningMsg.data(using: .utf8)!)
        
        // Use Task.sleep instead of RunLoop in async context
        while true { 
            try? await Task.sleep(nanoseconds: 250_000_000) // 250ms
        }
    }

    @available(macOS 13.0, *)
    private final class StreamOutput: NSObject, SCStreamOutput {
        private let dstFormat: AVAudioFormat
        private let frameCapacity: AVAudioFrameCount
        private var converter: AVAudioConverter?
        // Back-reference for stats/dump
        private weak var parent: AudioDumper?
        // Emit state: accumulate to stable ~100ms chunks
        private var emitBuffer: [Int16] = []
        private var firstChunkLogged: Bool = false
        // Accumulate source (float32) bytes until enough to yield ~100ms at 16k
        private var srcAccum = Data()
        private var srcAccumRate: Double = 0
        private var srcAccumChannels: Int = 0
        private var srcAccumNonInterleaved: Bool = true

        init(format: AVAudioFormat, frameCapacity: AVAudioFrameCount, parent: AudioDumper? = nil) {
            self.dstFormat = format
            self.frameCapacity = frameCapacity
            self.parent = parent
        }

        func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
            guard type == .audio, let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
            // Mark audio callback observed
            FileHandle.standardError.write("{\"status\":\"audio_cb\"}\n".data(using: .utf8)!)

            // Extract ASBD from CMSampleBuffer
            guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
                  let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)?.pointee else { return }

            // Copy raw float32 bytes out of blockBuffer
            let totalLength = CMBlockBufferGetDataLength(blockBuffer)
            var data = Data(count: totalLength)
            data.withUnsafeMutableBytes { (ptr: UnsafeMutableRawBufferPointer) in
                _ = CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: totalLength, destination: ptr.baseAddress!)
            }

            // Emit raw float32 like Glass
            let numSamples = CMSampleBufferGetNumSamples(sampleBuffer)
            let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
            let chCount = Int(asbd.mChannelsPerFrame)

            let b64 = data.base64EncodedString()
            let mime = "audio/float32;rate=\(Int(asbd.mSampleRate));channels=\(chCount)"
            let json = "{\"data\":\"\(b64)\", \"mimeType\":\"\(mime)\"}\n"
            FileHandle.standardOutput.write(json.data(using: .utf8)!)

            // Optional RMS (float32)
            data.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) in
                let f32 = ptr.bindMemory(to: Float.self)
                var sum: Double = 0
                let count = f32.count
                if count > 0 {
                    for i in 0..<count { let v = Double(f32[i]); sum += v * v }
                    let rms = sqrt(sum / Double(count))
                    print("RMS: \(rms)")
                }
            }
        }
    }
}

@main
struct Main {
    static func main() async {
        // Print version info
        printVersionInfo()
        
        // Check macOS version
        if #available(macOS 13.0, *) {
            do {
                let dumper = AudioDumper()
                try await dumper.start()
            } catch {
                let s = String(describing: error).replacingOccurrences(of: "\"", with: "'")
                let msg = "{\"error\":\"" + s + "\"}\n"
                FileHandle.standardError.write(msg.data(using: .utf8)!)
                exit(1)
            }
        } else {
            let msg = "{\"error\":\"This application requires macOS 13.0 or later\"}\n"
            FileHandle.standardError.write(msg.data(using: .utf8)!)
            exit(1)
        }
    }
}