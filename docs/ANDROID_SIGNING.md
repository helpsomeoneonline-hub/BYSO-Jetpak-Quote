# Permanent Android APK signing — required for seamless updates

GitHub Actions runners are disposable. Their default debug keystore changes across runs, so a new APK often cannot update an installed APK. Every delivered APK must retain the original applicationId, increase versionCode, and be signed with the **same private key and signing certificate**.

This workflow builds the existing Android variant, then re-signs the final APK with a retained app-specific keystore from encrypted GitHub Actions secrets. It checks the public SHA-256 fingerprint from an Actions variable before allowing the APK artifact to be published.

## One-time setup in this repository

Go to **Settings > Secrets and variables > Actions**.

If the private keystore used to sign the installed app exists, REUSE that key. If the key alias is not `app`, change the alias without changing the key/certificate (e.g. `keytool -changealias`). If its old signing key is lost, a new key cannot update that original installed APK: first back up app data and plan one controlled migration. The APK and its public certificate are insufficient to reconstruct the private key.

If no old key can be recovered, create a **new and then permanent** key on your trusted Windows computer with Java JDK keytool:
```powershell
keytool -genkeypair -keystore .\JetPak-signing.jks -storetype PKCS12 -alias app -keyalg RSA -keysize 3072 -validity 10950 -dname "CN=JetPak Quote, O=BYSO, C=TT"
```
Use a strong unique password; a PKCS12 private key uses the same password as its keystore.

Configure all three items in GitHub:
1. **Secret** `ANDROID_SIGNING_KEYSTORE_B64`: one-line Base64 of that original binary keystore file, generated with PowerShell:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path '.\JetPak-signing.jks')))
   ```
2. **Secret** `ANDROID_SIGNING_STORE_PASSWORD`: the keystore password.
3. **Variable** `ANDROID_SIGNING_CERT_SHA256`: the SHA-256 fingerprint for alias `app`, shown by:
   ```powershell
   keytool -list -v -keystore .\JetPak-signing.jks -alias app
   ```

Back up the keystore securely in two locations you control and retain its password in a password manager. Do not commit or send a private signing key/password in chat. Encrypted GitHub secrets are **not readable back** by the assistant; GitHub makes them available to the workflow for each new build. The certificate fingerprint, unlike the private key, is public and can be retrieved again from any signed APK.

Until setup is complete, the workflow will **intentionally fail** instead of delivering another APK with a different certificate. Do not mistake a successful Gradle compilation for a deliverable signed update.

For every future release: preserve the package ID and user data, increment versionCode, reuse the exact signing key, and test an install-over-existing-app path with a data backup.

## Historical JetPak APK signing certificate fingerprints (public)

- GitHub build v1.16.1, October 14, 2026: `F1E381CA0019E3CF64414FF59E3CE59B66C4B596E23F0A41803990F768B1EFF4`
- GitHub build v1.16.2, October 20, 2026: `B3F71FDE181C3AB47339B94B3742B5C6C19E6EB9DB5B3A0AA15C137C65BF947D`

The two builds **do not have the same signing certificate**. Do not claim either of them will install over the other. A permanent key chosen from now on can be used for all subsequent versions, though existing temporary-key installations may need one final migration.

References: https://developer.android.com/studio/publish/app-signing and https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
