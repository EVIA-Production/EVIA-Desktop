import Foundation
import AVFoundation
import ScreenCaptureKit
import AudioToolbox

// Phase 1: minimal CLI that captures system audio and writes base64 PCM16 mono 16kHz frames to stdout.

// Config (dst)
let sampleRate: Double = 24000
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
            // Using excludingDesktopWindows(false) and onScreenWindowsOnly(true) can affect audio availability
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
        config.sampleRate = 48000
        config.channelCount = 2
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

            let srcFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                          sampleRate: asbd.mSampleRate,
                                          channels: AVAudioChannelCount(asbd.mChannelsPerFrame),
                                          interleaved: false)!

            if converter == nil {
                // Initialize converter; default algorithm/quality are sufficient on macOS
                converter = AVAudioConverter(from: srcFormat, to: dstFormat)
            }

            // Copy raw float32 bytes out of blockBuffer
            let totalLength = CMBlockBufferGetDataLength(blockBuffer)
            var data = Data(count: totalLength)
            data.withUnsafeMutableBytes { (ptr: UnsafeMutableRawBufferPointer) in
                _ = CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: totalLength, destination: ptr.baseAddress!)
            }

            // Emit raw float32 interleaved frames directly (Glass-style) and return
            let numSamples = CMSampleBufferGetNumSamples(sampleBuffer)
            let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
            let chCount = Int(asbd.mChannelsPerFrame)

            // Log source format
            let jsonSrc = "{\"src_format\":{\"src_format_flags_hex\":\"00000029\",\"src_format_id_hex\":\"6C70636D\",\"src_bits_per_channel\":32,\"src_sample_rate\":\(Int(asbd.mSampleRate)),\"src_non_interleaved\":\(isNonInterleaved),\"src_bytes_per_frame\":4,\"src_channels\":\(chCount)},\"status\":\"src_format\"}\n"
            FileHandle.standardError.write(jsonSrc.data(using: String.Encoding.utf8)!)

            // Interleave if needed and send
            let interleaved = interleaveFloat32Data(data, channels: chCount, frames: numSamples, isNonInterleaved: isNonInterleaved)
            let b64 = interleaved.base64EncodedString()
            let obj: [String: Any] = ["data": b64, "mimeType": "audio/float32;rate=\(Int(asbd.mSampleRate));channels=\(chCount)"]
            if let json = try? JSONSerialization.data(withJSONObject: obj),
               let line = String(data: json, encoding: .utf8) {
                FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
            }

            // Optional RMS (float32)
            interleaved.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) in
                let f32 = ptr.bindMemory(to: Float.self)
                var sum: Double = 0
                let count = f32.count
                if count > 0 {
                    for i in 0..<count { let v = Double(f32[i]); sum += v * v }
                    let rms = sqrt(sum / Double(count))
                    let rmsStr = String(format: "%.4f", rms)
                    let rmsMsg = "[system] Chunk RMS=\(rmsStr) sampleCount=\(count)\n"
                    FileHandle.standardError.write(rmsMsg.data(using: .utf8)!)
                }
            }

            return
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

   func logAudioFormatDetails(format: AVAudioFormat) {
       let desc = format.streamDescription.pointee
       print("""
           Audio Format Details:
           - Sample Rate: \(format.sampleRate) Hz
           - Channels: \(format.channelCount)
           - Format ID: \(desc.mFormatID)
           - Format Flags: \(desc.mFormatFlags)
           - Bytes Per Packet: \(desc.mBytesPerPacket)
           - Frames Per Packet: \(desc.mFramesPerPacket)
           - Bytes Per Frame: \(desc.mBytesPerFrame)
           - Bits Per Channel: \(desc.mBitsPerChannel)
           """)
   }

   func makeWav(pcmData: Data, sampleRate: Int, channels: Int) -> Data? {
       var header = Data()
       let bitsPerSample = 16
       let byteRate = sampleRate * channels * bitsPerSample / 8
       let blockAlign = channels * bitsPerSample / 8
       let dataSize = UInt32(pcmData.count)
       let riffChunkSize = 36 + dataSize

       func write(_ value: UInt32) { var v = value.littleEndian; header.append(Data(bytes: &v, count: 4)) }
       func write16(_ value: UInt16) { var v = value.littleEndian; header.append(Data(bytes: &v, count: 2)) }

       header.append("RIFF".data(using: .ascii)!)
       write(riffChunkSize)
       header.append("WAVE".data(using: .ascii)!)
       header.append("fmt ".data(using: .ascii)!)
       write(16) // PCM fmt chunk size
       write16(1) // PCM format
       write16(UInt16(channels))
       write(UInt32(sampleRate))
       write(UInt32(byteRate))
       write16(UInt16(blockAlign))
       write16(UInt16(bitsPerSample))
       header.append("data".data(using: .ascii)!)
       write(dataSize)

       var wav = Data()
       wav.append(header)
       wav.append(pcmData)
       return wav
   }

    func makeWavFloat(pcmFloatData: Data, sampleRate: Int, channels: Int) -> Data? {
        var header = Data()
        let bitsPerSample = 32
        let format: UInt16 = 3 // IEEE float
        let byteRate = sampleRate * channels * (bitsPerSample / 8)
        let blockAlign = channels * (bitsPerSample / 8)
        let dataSize = UInt32(pcmFloatData.count)
        let riffChunkSize = 36 + dataSize

        func write(_ value: UInt32) { var v = value.littleEndian; header.append(Data(bytes: &v, count: 4)) }
        func write16(_ value: UInt16) { var v = value.littleEndian; header.append(Data(bytes: &v, count: 2)) }

        header.append("RIFF".data(using: .ascii)!)
        write(riffChunkSize)
        header.append("WAVE".data(using: .ascii)!)
        header.append("fmt ".data(using: .ascii)!)
        write(16)
        write16(format)
        write16(UInt16(channels))
        write(UInt32(sampleRate))
        write(UInt32(byteRate))
        write16(UInt16(blockAlign))
        write16(UInt16(bitsPerSample))
        header.append("data".data(using: .ascii)!)
        write(dataSize)

        var wav = Data()
        wav.append(header)
        wav.append(pcmFloatData)
        return wav
    }

    func interleaveFloat32Data(_ data: Data, channels: Int, frames: Int, isNonInterleaved: Bool) -> Data {
        if !isNonInterleaved { return data }
        var interleaved = Data(capacity: frames * channels * 4)
        data.withUnsafeBytes { ptr in
            let floats = ptr.bindMemory(to: Float.self).baseAddress!
            let planeSize = frames
            for f in 0..<frames {
                for ch in 0..<channels {
                    let val = floats[ch * planeSize + f]
                    var le = val
                    withUnsafeBytes(of: &le) { raw in
                        let u8 = raw.bindMemory(to: UInt8.self)
                        interleaved.append(u8.baseAddress!, count: MemoryLayout<Float>.size)
                    }
                }
            }
        }
        return interleaved
    }

    func calculateRMS(_ samples: [Int16]) -> Double {
        var sum = 0.0
        for s in samples {
            let norm = Double(s) / 32768.0
            sum += norm * norm
        }
        return sqrt(sum / Double(samples.count))
    }
