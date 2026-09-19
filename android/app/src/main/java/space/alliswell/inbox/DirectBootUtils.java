package space.alliswell.inbox;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.UserManager;

/**
 * Direct Boot (API 24+) 安全存储与上下文工具类。
 * 设备重启后首次解锁前（LOCKED_BOOT_COMPLETED），Credential Encrypted (CE) 存储不可用；
 * 参与开机恢复、闹钟广播接收、前台响铃服务及锁屏界面的组件必须使用 Device Protected (DE) 存储。
 */
final class DirectBootUtils {
  private DirectBootUtils() {}

  /** 检查用户是否已完成首次解锁 */
  static boolean isUserUnlocked(Context context) {
    if (context == null) return false;
    if (Build.VERSION.SDK_INT >= 24) {
      UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
      return um != null && um.isUserUnlocked();
    }
    return true;
  }

  /**
   * 获取安全上下文：若设备处于未解锁状态，自动切换为 Device Protected Storage 上下文，
   * 避免访问 CE 存储抛出 IllegalStateException。
   */
  static Context getSafeContext(Context context) {
    if (context == null) return null;
    if (Build.VERSION.SDK_INT >= 24) {
      UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
      if (um != null && !um.isUserUnlocked()) {
        return context.createDeviceProtectedStorageContext();
      }
    }
    return context;
  }

  /**
   * 安全获取 SharedPreferences：未解锁时自动读写 DE 存储，已解锁后读写标准 CE 存储。
   */
  static SharedPreferences getSafeSharedPreferences(Context context, String name, int mode) {
    if (context == null) return null;
    if (Build.VERSION.SDK_INT >= 24) {
      if (context.isDeviceProtectedStorage()) {
        return context.getSharedPreferences(name, mode);
      }
      UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
      if (um != null && !um.isUserUnlocked()) {
        Context de = context.createDeviceProtectedStorageContext();
        if (de != null) {
          return de.getSharedPreferences(name, mode);
        }
      }
    }
    Context target = context.getApplicationContext() != null ? context.getApplicationContext() : context;
    return target.getSharedPreferences(name, mode);
  }

  private static volatile String sCachedBootId = null;

  /**
   * 获取内核稳定开机标识。读取 /proc/sys/kernel/random/boot_id，
   * 该值在单次系统开机周期内绝对稳定，绝不受用户修改系统时间（前拨/回拨）或修改时区的影响。
   */
  static synchronized String getBootId() {
    if (sCachedBootId != null) return sCachedBootId;
    try {
      java.io.File file = new java.io.File("/proc/sys/kernel/random/boot_id");
      if (file.exists() && file.canRead()) {
        try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(file))) {
          String line = reader.readLine();
          if (line != null && !line.trim().isEmpty()) {
            sCachedBootId = line.trim();
            return sCachedBootId;
          }
        }
      }
    } catch (Exception ignored) {}
    sCachedBootId = java.util.UUID.randomUUID().toString();
    return sCachedBootId;
  }
}
