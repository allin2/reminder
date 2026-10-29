package space.alliswell.inbox;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.GeneralSecurityException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Only ciphertext + fresh IV live in CE preferences. The AES key never leaves AndroidKeyStore. */
@CapacitorPlugin(name = "SecureKey")
public class SecureKeyPlugin extends Plugin {
  private static final String ALIAS = "attention.ai.aes.v1";
  private static final String PREFS = "secure_ai_key";
  private SharedPreferences prefs() {
    return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }
  private KeyStore keyStore() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    return store;
  }
  private SecretKey encryptionKey() throws Exception {
    KeyStore store = keyStore();
    if (store.containsAlias(ALIAS)) {
      SecretKey key = (SecretKey) store.getKey(ALIAS, null);
      if (key != null) return key;
      // A stale alias must not permanently prevent key generation.
      store.deleteEntry(ALIAS);
    }
    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    generator.init(new KeyGenParameterSpec.Builder(ALIAS,
        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true).build());
    return generator.generateKey();
  }
  @PluginMethod
  public synchronized void set(PluginCall call) {
    String value = call.getString("value");
    if (value == null || value.isEmpty()) { call.reject("缺少密钥"); return; }
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
      byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
      if (!prefs().edit().putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
          .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) {
        call.reject("安全存储写入失败"); return;
      }
      call.resolve();
    } catch (Exception e) { call.reject("安全存储写入失败"); }
  }
  @PluginMethod
  public synchronized void get(PluginCall call) {
    try {
      SharedPreferences preferences = prefs();
      String encrypted = preferences.getString("ciphertext", null);
      String iv = preferences.getString("iv", null);
      JSObject result = new JSObject();
      if (encrypted == null && iv == null) { result.put("value", ""); call.resolve(result); return; }
      try {
        SecretKey key = (SecretKey) keyStore().getKey(ALIAS, null);
        if (key == null || encrypted == null || iv == null) throw new GeneralSecurityException();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        result.put("value", new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8));
      } catch (GeneralSecurityException | IllegalArgumentException e) {
        // Restored ciphertext has no corresponding Keystore key. Reset, never crash or log secrets.
        if (!preferences.edit().clear().commit()) { call.reject("安全存储清理失败"); return; }
        // Cleanup is best effort once ciphertext has been cleared.
        try { keyStore().deleteEntry(ALIAS); } catch (Exception ignored) {}
        result.put("value", "");
        result.put("reset", true);
      }
      call.resolve(result);
    } catch (Exception e) { call.reject("安全存储读取失败"); }
  }
  @PluginMethod
  public synchronized void remove(PluginCall call) {
    // Keep the encryption key: no ciphertext remains; avoiding a delete/write race also makes retries safe.
    if (prefs().edit().clear().commit()) call.resolve();
    else call.reject("安全存储清理失败");
  }
}
