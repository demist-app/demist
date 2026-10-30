// Live lecture transcription with Apple's SpeechAnalyzer + SpeechTranscriber
// (iOS 26+), entirely on the device.
//
// WHY: Demist's first iPhone builds used SFSpeechRecognizer through
// expo-speech-recognition. On harder vocabulary it was visibly worse (first
// device test, 2026-10-30), and a published benchmark puts it at ~16% word
// error against ~4.6% for SpeechTranscriber. The old engine stays as the
// fallback for older iPhones and unsupported languages (lib/speech.ts).
//
// Events mirror what lib/recording.tsx already handles from the old engine:
//   onResult { text, isFinal }  volatile text replaces, final text appends
//   onVolume { level }          0..1, at most four times a second
//   onError  { code, message }
//   onEnd    {}                 after stop, or when the analyzer gives up
import ExpoModulesCore
import AVFoundation
import Speech

struct SpeechFailure: LocalizedError {
  let code: String
  var errorDescription: String? { code }
}

public class DemistSpeechModule: Module {
  // Typed as AnyObject so this class needs no iOS 26 annotation.
  private var live: AnyObject?

  public func definition() -> ModuleDefinition {
    Name("DemistSpeech")
    Events("onResult", "onVolume", "onError", "onEnd")

    // Can the new engine transcribe this language on this phone? Never
    // downloads anything.
    AsyncFunction("isAvailable") { (locale: String) async -> Bool in
      if #available(iOS 26.0, *) {
        return await LiveTranscriber.resolveLocale(locale) != nil
      }
      return false
    }

    // Makes sure the language model is on the phone (a one-off download the
    // first time). Returns false when the language is not supported.
    AsyncFunction("prepare") { (locale: String) async throws -> Bool in
      if #available(iOS 26.0, *) {
        return try await LiveTranscriber.ensureModel(locale)
      }
      return false
    }

    AsyncFunction("start") { (locale: String) async throws in
      guard #available(iOS 26.0, *) else { throw SpeechFailure(code: "unavailable") }
      if let old = self.live as? LiveTranscriber { await old.stop() }
      let transcriber = LiveTranscriber { [weak self] name, body in self?.sendEvent(name, body) }
      self.live = transcriber
      do {
        try await transcriber.start(localeId: locale)
      } catch {
        // Quietly: JS falls back to the old engine, and an onEnd here would
        // read as the recogniser stopping mid-lecture.
        self.live = nil
        await transcriber.abandon()
        throw error
      }
    }

    AsyncFunction("stop") { () async in
      if #available(iOS 26.0, *) {
        if let current = self.live as? LiveTranscriber { await current.stop() }
      }
      self.live = nil
    }
  }
}

@available(iOS 26.0, *)
final class LiveTranscriber {
  private let emit: (String, [String: Any?]) -> Void
  private let engine = AVAudioEngine()
  private var analyzer: SpeechAnalyzer?
  private var inputBuilder: AsyncStream<AnalyzerInput>.Continuation?
  private var analyzerFormat: AVAudioFormat?
  private var converter: AVAudioConverter?
  private var resultsTask: Task<Void, Never>?
  private var observers: [NSObjectProtocol] = []
  private var lastLevelAt: TimeInterval = 0
  private var stopped = false
  private var endSent = false
  private var muted = false

  init(emit: @escaping (String, [String: Any?]) -> Void) {
    self.emit = emit
  }

  private func send(_ name: String, _ body: [String: Any?]) {
    if !muted { emit(name, body) }
  }

  /// Stops without telling JS anything, for a start that failed.
  func abandon() async {
    muted = true
    await stop()
  }

  // The model for the requested language and region, or failing that the
  // same language in another region: an en-GB lecture on the en-US model is
  // still far better than the old engine.
  static func resolveLocale(_ id: String) async -> Locale? {
    let wanted = Locale(identifier: id)
    let supported = await SpeechTranscriber.supportedLocales
    if let exact = supported.first(where: { $0.identifier(.bcp47) == wanted.identifier(.bcp47) }) {
      return exact
    }
    return supported.first(where: { $0.language.languageCode == wanted.language.languageCode })
  }

  static func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
    SpeechTranscriber(
      locale: locale,
      transcriptionOptions: [],
      reportingOptions: [.volatileResults],
      attributeOptions: []
    )
  }

  static func ensureModel(_ id: String) async throws -> Bool {
    guard let locale = await resolveLocale(id) else { return false }
    let transcriber = makeTranscriber(locale)
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      try await request.downloadAndInstall()
    }
    return true
  }

  func start(localeId: String) async throws {
    guard let locale = await Self.resolveLocale(localeId) else {
      throw SpeechFailure(code: "language-not-supported")
    }
    let transcriber = Self.makeTranscriber(locale)
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      try await request.downloadAndInstall()
    }
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
      throw SpeechFailure(code: "no-audio-format")
    }
    analyzerFormat = format

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let (stream, builder) = AsyncStream<AnalyzerInput>.makeStream()
    inputBuilder = builder
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    self.analyzer = analyzer

    resultsTask = Task { [weak self] in
      do {
        for try await result in transcriber.results {
          let text = String(result.text.characters)
          self?.send("onResult", ["text": text, "isFinal": result.isFinal])
        }
      } catch {
        self?.send("onError", ["code": "analyzer", "message": error.localizedDescription])
      }
      self?.sendEnd()
    }

    try await analyzer.start(inputSequence: stream)
    try installTapAndStart()
    observeSession()
  }

  func stop() async {
    if stopped { return }
    stopped = true
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    inputBuilder?.finish()
    inputBuilder = nil
    if let analyzer {
      try? await analyzer.finalizeAndFinishThroughEndOfInput()
    }
    // The results loop ends once the analyzer finishes; give it a moment to
    // deliver the last final text, then make sure JS hears onEnd either way.
    if let task = resultsTask {
      _ = await withTaskGroup(of: Void.self) { group in
        group.addTask { await task.value }
        group.addTask { try? await Task.sleep(nanoseconds: 2_000_000_000) }
        await group.next()
        group.cancelAll()
      }
    }
    sendEnd()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func sendEnd() {
    if endSent { return }
    endSent = true
    send("onEnd", [:])
  }

  // Installed again whenever the input changes (headphones, AirPods), since
  // the microphone's format changes with it.
  private func installTapAndStart() throws {
    guard let analyzerFormat else { return }
    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    if inputFormat.sampleRate == 0 || inputFormat.channelCount == 0 {
      throw SpeechFailure(code: "audio-busy")
    }
    converter = AVAudioConverter(from: inputFormat, to: analyzerFormat)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
      guard let self else { return }
      self.reportLevel(buffer)
      if let converted = self.convert(buffer) {
        self.inputBuilder?.yield(AnalyzerInput(buffer: converted))
      }
    }
    engine.prepare()
    try engine.start()
  }

  private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let converter, let analyzerFormat else { return nil }
    if buffer.format == analyzerFormat { return buffer }
    let ratio = analyzerFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
    guard let out = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: capacity) else { return nil }
    var consumed = false
    var error: NSError?
    let status = converter.convert(to: out, error: &error) { _, inputStatus in
      if consumed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    if status == .error || out.frameLength == 0 { return nil }
    return out
  }

  // Root mean square of the first channel, mapped from roughly -60..0 dB to
  // 0..1 for the calm level bars.
  private func reportLevel(_ buffer: AVAudioPCMBuffer) {
    let now = Date().timeIntervalSince1970
    if now - lastLevelAt < 0.25 { return }
    lastLevelAt = now
    guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
    var sum: Float = 0
    let n = Int(buffer.frameLength)
    for i in 0..<n { sum += data[i] * data[i] }
    let rms = sqrt(sum / Float(n))
    let db = 20 * log10(max(rms, 0.000_001))
    let level = max(0, min(1, (db + 60) / 60))
    send("onVolume", ["level": Double(level)])
  }

  private func observeSession() {
    let center = NotificationCenter.default
    // A phone call or Siri pauses the microphone; carry on when it ends.
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      guard let self, !self.stopped,
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw), type == .ended else { return }
      do {
        try AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
        try self.installTapAndStart()
      } catch {
        self.send("onError", ["code": "interrupted", "message": error.localizedDescription])
      }
    })
    observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
      guard let self, !self.stopped else { return }
      do {
        try self.installTapAndStart()
      } catch {
        self.send("onError", ["code": "route-change", "message": error.localizedDescription])
      }
    })
  }
}
