import Foundation
import AVFoundation
import ScreenCaptureKit

// Phase 1: minimal CLI that captures system audio and writes base64 PCM16 mono 16kHz frames to stdout.

// Config
let sampleRate: Double = 16_000
let frameDurationSec: Double = 0.1 // 100 ms
let channels: AVAudioChannelCount = 1

final class AudioDumper: NSObject {
    private var stream: SCStream?
    private var output: SCStreamOutput?
    private var audioConverter: AVAudioConverter?
    private var dstFormat: AVAudioFormat
    private let dstFrameCapacity: AVAudioFrameCount

    override init() {
        self.dstFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: channels, interleaved: true)!
        self.dstFrameCapacity = AVAudioFrameCount(sampleRate * frameDurationSec)
        super.init()
    }

    func start() async throws {
        // Request capture permission implicitly; user must have Screen Recording permission
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            throw NSError(domain: "SystemAudioCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display found"])
        }

        // Configure stream for audio only
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = false
        config.sampleRate = sampleRate
        config.channelCount = Int(channels)

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        self.stream = stream

        let output = StreamOutput(format: dstFormat, frameCapacity: dstFrameCapacity)
        self.output = output
        try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: .global())

        try await stream.startCapture()

        // Keep running
        RunLoop.current.run()
    }

    private final class StreamOutput: NSObject, SCStreamOutput {
        private let dstFormat: AVAudioFormat
        private let frameCapacity: AVAudioFrameCount
        private var converter: AVAudioConverter?

        init(format: AVAudioFormat, frameCapacity: AVAudioFrameCount) {
            self.dstFormat = format
            self.frameCapacity = frameCapacity
        }

        func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
            guard type == .audio, let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }

            // Extract ASBD from CMSampleBuffer
            guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
                  let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)?.pointee else { return }

            let srcFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                          sampleRate: asbd.mSampleRate,
                                          channels: AVAudioChannelCount(asbd.mChannelsPerFrame),
                                          interleaved: false)!

            if converter == nil {
                converter = AVAudioConverter(from: srcFormat, to: dstFormat)
            }

            // Read audio into AVAudioPCMBuffer (float32)
            let totalLength = CMBlockBufferGetDataLength(blockBuffer)
            var data = Data(count: totalLength)
            data.withUnsafeMutableBytes { (ptr: UnsafeMutableRawBufferPointer) in
                _ = CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: totalLength, destination: ptr.baseAddress!)
            }

            let frameCount = AVAudioFrameCount(totalLength) / (4 * AVAudioFrameCount(srcFormat.channelCount))
            guard frameCount > 0 else { return }

            guard let srcBuf = AVAudioPCMBuffer(pcmFormat: srcFormat, frameCapacity: frameCount) else { return }
            srcBuf.frameLength = frameCount

            // Deinterleave/assign float32 data into srcBuf
            data.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) in
                let f32 = ptr.bindMemory(to: Float.self)
                for ch in 0..<Int(srcFormat.channelCount) {
                    let channelPtr = srcBuf.floatChannelData![ch]
                    var i = ch
                    for frame in 0..<Int(frameCount) {
                        channelPtr[frame] = f32[i]
                        i += Int(srcFormat.channelCount)
                    }
                }
            }

            // Convert to dst (int16 mono 16k)
            guard let dstBuf = AVAudioPCMBuffer(pcmFormat: dstFormat, frameCapacity: frameCapacity) else { return }
            let inputBlock: AVAudioConverterInputBlock = { inNumPackets, outStatus in
                outStatus.pointee = .haveData
                return srcBuf
            }
            do {
                try converter?.convert(to: dstBuf, error: nil, withInputFrom: inputBlock)
            } catch {
                return
            }

            // Emit in chunks ~100ms
            let frames = Int(dstBuf.frameLength)
            guard frames > 0, let int16Ptr = dstBuf.int16ChannelData?.pointee else { return }
            let bytesPerFrame = MemoryLayout<Int16>.size * Int(dstFormat.channelCount)
            let byteCount = frames * bytesPerFrame
            let b64 = Data(bytes: int16Ptr, count: byteCount).base64EncodedString()
            // Write JSON line to stdout
            let obj: [String: Any] = ["data": b64, "mimeType": "audio/pcm;rate=16000"]
            if let json = try? JSONSerialization.data(withJSONObject: obj),
               let line = String(data: json, encoding: .utf8) {
                FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
            }
        }
    }
}

@main
struct Main {
    static func main() async {
        do {
            let dumper = AudioDumper()
            try await dumper.start()
        } catch {
            let msg = "{\"error\":\"") + String(describing: error).replacingOccurrences(of: "\"", with: "'") + "\"}\n"
            FileHandle.standardError.write(msg.data(using: .utf8)!)
            exit(1)
        }
    }
}


