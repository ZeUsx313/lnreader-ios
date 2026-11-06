Pod::Spec.new do |s|
  s.name           = 'LNReaderReaderAssets'
  s.version        = '1.0.0'
  s.summary        = 'Bundled reader WebView runtime assets (css/js/fonts)'
  s.description    = 'Resource bundle populated at prebuild time by plugins/withReaderAssets.js'
  s.license        = 'MIT'
  s.author         = 'LNReader iOS port'
  s.homepage       = 'https://github.com/LNReader/lnreader'
  s.platforms      = { :ios => '15.5' }
  s.source         = { :path => '.' }

  # Directory structure (css/ js/ fonts/) is preserved inside the bundle.
  s.resource_bundles = { 'LNReaderReaderAssets' => ['ReaderAssets/**/*'] }
end
