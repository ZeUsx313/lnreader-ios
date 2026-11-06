# تقرير التدقيق الشامل — LNReader → iOS

> المستودع الأصلي: `lnreader/lnreader` @ `dc394e85` (master، 2026-11).
> المستودع المعدّل: `syfslfk00-debug/lnreader-ios` @ فرع `ios-port`.

## 1. البنية التقنية المكتشفة

| المكوّن | الإصدار/التقنية | ملاحظة iOS |
|---|---|---|
| Expo SDK | 57 | يدعم iOS رسميًا |
| React Native | 0.86 (Hermes) | حد أدنى افتراضي ≤ 18.5 ✓ |
| قاعدة البيانات | op-sqlite 15 + Drizzle 1.0-beta + WAL | عابر للمنصات (تعديل مسار iOS فقط) |
| إعدادات | react-native-mmkv 4 | يدعم iOS |
| القارئ | WebView + VanJS (assets/reader) | WKWebView متوافق بعد تثبيت المسارات |
| الإضافات | `Function('require','module', …)` داخل Hermes | **متوافق أصلًا** — لا WebView ولا محرك خارجي |
| EPUB | nitro-epub (C++ مشترك + pugixml + zlib) | جاهز لـ iOS كما هو |
| TTS | nitro-tts | **تنفيذ Swift كامل موجود مسبقًا** (AVSpeechSynthesizer + NowPlaying) |

## 2. خريطة الملفات والوظائف (المسارات الحيوية)

- `src/plugins/pluginManager.ts` — تحميل القائمة، التنزيل، `initPlugin` (تقييم الكود)، التحديث، التخزين في `Documents/Plugins/<id>/index.js`.
- `src/plugins/helpers/fetch.ts` — `fetchApi/fetchText/fetchProto/downloadFile` (واجهة `@libs/fetch` للإضافات).
- `src/plugins/helpers/storage.ts` — تخزين MMKV (`plugin_db`) بإضافة بادئة `<id>_DB_`.
- `src/database/db.ts` — فتح op-sqlite + Pragma + ترحيلات Drizzle + مشغلات إحصائيات.
- `src/services/download/downloadChapter.ts` — تنزيل الفصول إلى `Novels/<plugin>/<novel>/<chapter>/index.html` + صور `<n>.b64.png`.
- `src/services/backgroundTasks/*` — طابور مهام JS فوق وحدة أصلية (WorkManager على أندرويد).
- `src/screens/reader/components/WebViewReader.tsx` — توليد HTML كامل لكل فصل + حقن CSS/JS/خطوط + بروتوكول رسائل.
- `modules/*` — 9 وحدات أصلية (تفاصيلها في مصفوفة التوافق).

## 3. مصفوفة التوافق Android/iOS (قبل التعديلات)

| الوحدة/الآلية | أندرويد | iOS قبل التعديل | الإجراء المنفذ في `ios-port` |
|---|---|---|---|
| nitro-epub | ✓ | ✓ (C++ مشترك) | لا شيء — جاهز |
| nitro-tts | ✓ | ✓ (Swift كامل) | لا شيء — جاهز |
| native-file | ✓ | 🟡 ناقص | **Swift كامل**: `downloadFile` (URLSession+كوكيز)، `createDocument/pickDocument/pickDirectory` (UIDocumentPicker)، `BundlePath`، حماية Security-Scoped Bookmarks |
| native-zip-archive | ✓ | 🔴 stub | **Swift كامل** بـ ZIPFoundation: `zip/unzip/remoteZip(POST)/remoteUnzip` بمطابقة دلالات Kotlin |
| native-volume-button-listener | ✓ | 🔴 stub | **Swift**: KVO على `outputVolume` (بقيد موثق: لا يمكن منع تغير الصوت في iOS) |
| native-background-tasks | ✓ WorkManager | 🔴 يُصرح بـ apple بدون كود → سقوط بناء | إزالة apple من الكونفج + **تنفيذ TS كامل** (MMKV queue) + مجدول in-app بحدود 3 مسارات تنزيل + جداول زمنية تُفحص عند الإقلاع |
| native-share-receiver | ✓ | 🔴 يُنهار عند الاستيراد | Shim آمن لـ iOS (قابلية إضافة Share Extension لاحقًا) |
| native-doh | ✓ | ⚪ محجوب بـ JS بأمان | بقي أندرويد-فقط (سبب تقني موثق) |
| native-crash-logs | ✓ | ⚪ محجوب بـ JS بأمان | بقي أندرويد-فقط |
| قراءة assets القارئ | `file:///android_asset` | 🔴 مسار غير موجود | Config plugin iOS ينسخ إلى bundle + `getReaderAssetsPrefix()` |
| Toast | ToastAndroid | 🔴 ينهار | `showToast` متعدد المنصات + `ToastHost` في App |
| قاعدة البيانات | `../files/SQLite` | 🟡 مسار غير قياسي | `location: 'default'` (Library) على iOS |
| Google Drive نسخ احتياطي | ✓ | 🟡 يحتاج GIDClientID | موثق في LIMITATIONS (يحتاج OAuth إعداد المستخدم) |

## 4. العوائق القاطعة التي وُجدت وأُصلحت

1. `expo-module.config.json` لوحدة background-tasks يصرّح بـ apple بدون تنفيذ → فشل pod/بناء. **أُصلح.**
2. `requireNativeModule('NativeShareReceiver')` غير اختياري → انهيار إقلاع iOS. **أُصلح.**
3. مسار `file:///android_asset` في 4 ملفات (WebViewReader + شاشتان إعدادتان + core.js) → قارئ بلا CSS/JS/خطوط. **أُصلح** (plugin + prefix util + حقن `LN_READER_ASSETS_PREFIX`).
4. `ToastAndroid` في مئات المسارات → استثناءات iOS. **أُصلح.**
5. `NativeFile.downloadFile` stub → فشل تنزيل الصور/الأغلفة/الإضافات المخصصة. **أُصلح (تنزيل حقيقي).**
6. `NativeZipArchive` stub ×4 → فشل النسخ الاحتياطي/الاستعادة/remote. **أُصلح (ZIPFoundation).**

## 5. ما لم يُختبر محليًا (شفافية)

- بيئة التطوير هنا Linux بلا Xcode/محاكي — **بناء iOS واختبار المحاكي يُنفَّذان عبر GitHub Actions (macos-15/Xcode 16.4/iOS 18.x runtime)**، والنتائج الفعلية موثقة بتقارير الـworkflow ولقطات الشاشة المرفوعة كـArtifacts.
- جهاز iPad 7 حقيقي (A10) غير متاح — التحقق الفعلي للمعمارية محصور في: بناء arm64 نظيف + MinimumOSVersion ≤ 18.5.
