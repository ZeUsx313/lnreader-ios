# تثبيت IPA غير الموقّع على iPad / iPhone

الـIPA المنتَج من CI (`LNReader-ios-unsigned-ipa` artifact) **غير موقّع** — Apple تمنع تثبيته مباشرة. خيارات التوقيع:

## الخيار 1 — AltStore / SideStore (أسهل للمستخدم الفردي، مجاني)

1. ثبّت AltServer على حاسوب (Windows/macOS).
2. ضع ملف الـIPA على الهاتف/الجهاز أو استخدم "Install IPA" من AltStore.
3. سجّل بنفس Apple ID (حد 7 أيام لإعادة التوقيع على الحساب المجاني، 3 أجهزة كحد أقصى).

## الخيار 2 — Sideloadly

1. ثبّت Sideloadly على الحاسوب.
2. اسحب `LNReader-ios-unsigned.ipa`، أدخل Apple ID، اضغط Start.
3. على الجهاز: Settings → General → VPN & Device Management → ثق بالشهادة.

## الخيار 3 — توقيع يدوي بـ codesign + Apple ID مجاني (macOS مطلوب)

```bash
# 1) فك الضغط
unzip LNReader-ios-unsigned.ipa -d signed && cd signed

# 2) أنشئ ملف entitlements.plist (الحد الأدنى)
cat > entitlements.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>application-identifier</key><string>TEAMID.com.rajarsheechatterjee.LNReader</string>
  <key>keychain-access-groups</key><array><string>TEAMID.com.rajarsheechatterjee.LNReader</string></array>
  <key>get-task-allow</key><true/>
</dict></plist>
EOF

# 3) وقّع كل الأطر ثنائية داخل .app أولاً ثم الحزمة (TEAMID استبدله بمعرفك من developer.apple.com/account أو من Xcode)
find Payload/LNReader.app -name '*.framework' -o -name '*.dylib' -o -name '*.appex' | while read f; do
  codesign -f -s "Apple Development: you@mail.com" --entitlements entitlements.plist "$f"
done
codesign -f -s "Apple Development: you@mail.com" --entitlements entitlements.plist Payload/LNReader.app

# 4) أعد الضغط وثبت عبر Xcode (Devices) أو ideviceinstaller
zip -qry ../LNReader-signed.ipa Payload
```

## الخيار 4 — حساب Apple Developer مدفوع (99$/سنة)

توقيع كامل عبر Xcode أو `xcodebuild -exportArchive` مع provisioning profile — بدون حد 7 أيام.

## متطلبات الجهاز المستهدف

| البند | القيمة |
|---|---|
| الجهاز | iPad 7 (2019) — A10 Fusion |
| النظام | iPadOS 18.5 (الـMinimumOSVersion في الـIPA ≤ 18.5) |
| المعمارية | arm64 |
| ملاحظة | المعرف `com.rajarsheechatterjee.LNReader` — عند التوقيع بـ Apple ID مجاني قد تحتاج تغييره عبر Xcode إن كان محجوزًا |
