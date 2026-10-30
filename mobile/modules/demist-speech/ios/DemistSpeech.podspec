Pod::Spec.new do |s|
  s.name           = 'DemistSpeech'
  s.version        = '1.0.0'
  s.summary        = 'Live on-device lecture transcription with Apple SpeechAnalyzer (iOS 26+)'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'Graceful Minds'
  s.homepage       = 'https://demist.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
