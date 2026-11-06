# قائمة الإصلاحات المنفذة — فرع ios-port

كل إصلاح مرتبط بـ commit. النطاق: جعل LNReader يبنى ويعمل على iPhone/iPad دون حذف أي ميزة أو وضع شاشات شكلية.

## W1 — وحدات Swift أصلية

| الملف | التغيير |
|---|---|
| `modules/native-zip-archive/ios/NativeZipArchiveModule.swift` | استبدال 4 stubs بتنفيذ كامل: `zip/unzip` عبر ZIPFoundation، `remoteUnzip` (تنزيل+فك)، `remoteZip` (ضغط+POST وإرجاع نص الاستجابة) — مطابقة لدلالات Kotlin بما فيها فشل non-200 |
| `modules/native-zip-archive/ios/NativeZipArchive.podspec` | إضافة `ZIPFoundation ~> 0.9.19` |
| `modules/native-file/ios/NativeFileModule.swift` | `downloadFile` حقيقي (URLSession، method/headers/body، كوكيز مشتركة، إنشاء مجلدات)، `createDocument/pickDocument/pickDirectory` عبر UIDocumentPicker، `BundlePath` Constant، Security-Scoped Bookmarks للوصول الدائم للمجلدات المنتقاة (ما يعادل SAF tree URIs) |
| `modules/native-volume-button-listener/ios/NativeVolumeButtonListenerModule.swift` | `setActive` + KVO على `AVAudioSession.outputVolume` يبث `VolumeUp/VolumeDown` |

## W2 — منع انهيار الإقلاع

| الملف | التغيير |
|---|---|
| `modules/native-background-tasks/expo-module.config.json` | حذف التصريح الزائف بـ apple (كان سيُسقط البناء) |
| `modules/native-background-tasks/src/NativeBackgroundTasksModule.ts` | توزيع منصات: Android→native، iOS→تنفيذ TS |
| `modules/native-background-tasks/src/IosNativeBackgroundTasks.ts` | **جديد** — طابور مهام كامل MMKV-persisted: enqueue/pause/resume/cancel/progress/checkpoint/complete/fail(مع إعادة محاولة ≤3) + جداول زمنية + استرداد المهام المقطوعة عند الإقلاع |
| `modules/native-background-tasks/index.ts` | تصدير الدوال المساعدة |
| `modules/native-share-receiver/src/NativeShareReceiverModule.ts` | Shim iOS آمن بدل الانهيار عند `requireNativeModule` |
| `src/utils/showToast.ts` | متعدد المنصات (ToastAndroid على أندرويد، مستضيف JS على iOS) |
| `src/components/Common/ToastHost.tsx` + `App.tsx` | **جديد** — مضيف Toast حقيقي لـ iOS |
| `src/screens/novel/components/Tracker/TrackSheet.tsx` | إزالة `ToastAndroid` المباشر |

## W3 — قارئ iOS

| الملف | التغيير |
|---|---|
| `plugins/withReaderAssets.js` | إضافة mod لـ iOS: نسخ `assets/reader/{css,js,fonts}` إلى `ios/<project>/ReaderAssets` + إضافتها لمرحلة Resources في Xcode (folder reference) |
| `src/utils/readerAssets.ts` | **جديد** — `getReaderAssetsPrefix()`: dev→metro، Android→android_asset، iOS→`file://<BundlePath>/ReaderAssets` |
| `src/screens/reader/components/WebViewReader.tsx` | استخدام البادئة الجديدة + حقن `window.LN_READER_ASSETS_PREFIX` قبل سكربتات القارئ |
| `assets/reader/js/core.js` | تحميل الخطوط عبر البادئة المحقونة (fallback للأندرويد) |
| `SettingsReaderWebView.tsx` + `SettingsWebView.tsx` | نفس تصحيح البادئة + الخطوط |

## W4 — المهام الخلفية على iOS

| الملف | التغيير |
|---|---|
| `src/services/backgroundTasks/iosScheduler.ts` | **جديد** — مُجدِّد in-app: مسارات تنزيل ≤3 لكل مصدر، تتابع لكل نوع مهمة، استئناف بنقاط التحقق، فحص الجداول الزمنية عند الإقلاع (بديل WorkManager periodic) |
| `src/services/backgroundTasks/BackgroundTaskQueue.ts` | استدعاء `drain()` بعد enqueue/resume (استيراد كسول لكسر الدورة) |
| `src/hooks/common/useInitializeAppServices.ts` | drain + فحص الجداول عند بدء التطبيق |

## W5 — قاعدة البيانات والتخزين

| الملف | التغيير |
|---|---|
| `src/database/db.ts` | `location: 'default'` على iOS (Library/lnreader.db) مع إبقاء مسار أندرويد كما هو، وقرصة Platform محمية لبيئة Node/الاختبارات |

## W6 — تكوين iOS

| الملف | التغيير |
|---|---|
| `app.json` | `ios.supportsTablet: true`، أيقونة iOS من أصل الأندرويد 1024px، ATS (`NSAllowsArbitraryLoads`) لمصادر http، `ITSAppUsesNonExemptEncryption` |

## W7 — اختبارات وCI

| الملف | الوصف |
|---|---|
| `scripts/plugin-smoke-test.mjs` | **جديد** — اختبار تكاملي للمحرك الإضافي ضد مصادر حقيقية (منهجية أدناه) |
| `.github/workflows/ios-build.yml` | **جديد** — quality (lint/types/jest/plugin) + macOS: prebuild → pods → بناء Simulator → اختبار إقلاع iPad 120s بلقطات → بناء arm64 غير موقع → IPA → تحققات هيكلية |

## منهجية اختبار الإضافات الحقيقية

تشغيل نفس مسار التطبيق حرفيًا: `fetch(dist) → Function('require','module',code) → require map (cheerio/htmlparser2/dayjs/urlencode/@libs/*) → searchNovels/popularNovels → parseNovel → parseChapter` مع تنفيذ `fetchProto` (gRPC-web) الفعلي. النتائج الحالية:

| المصدر | اللغة | النتيجة | تفاصيل |
|---|---|---|---|
| wuxiaworld | الإنجليزية | ✅ | 2376 فصلًا، 12,757 حرفًا (عبر gRPC-web) |
| ixdzs8 | **الصينية** | ✅ | 627 فصلًا، 1,373 حرفًا |
| sunovels | **العربية** | ✅ | 50 فصلًا (مصدر مترقم عبر parsePage) |
| kakuyomu | اليابانية | ✅ سابقًا / ⚠️ تذبذب rate-limit | مرّ مرتين بمحتوى كامل |
| royalroad/novelbin/quanben/linovelib | مختلطة | ❌ حجب IP مركز بيانات (403/سلوك Cloudflare) | قيد بيئي وليس عيب محرك |
