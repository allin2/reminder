package space.alliswell.inbox;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

/** 针对 ACTION_CREATE_DOCUMENT 写入边界的 JVM 测试；不接触用户真实文件。 */
public class ExportDocumentTest {

  @Test
  public void writesChineseJsonAsUtf8AndClosesStream() throws Exception {
    TrackingOutputStream stream = new TrackingOutputStream(false);

    String json = "{\"事项\":\"喝水\"}";
    SystemBridgePlugin.writeUtf8Stream(stream, json);

    assertEquals(json, new String(stream.toByteArray(), StandardCharsets.UTF_8));
    assertEquals(true, stream.closed);
  }

  @Test
  public void writesEmptyBackupContentAndStillClosesStream() throws Exception {
    TrackingOutputStream stream = new TrackingOutputStream(false);

    SystemBridgePlugin.writeUtf8Stream(stream, "");

    assertEquals(0, stream.size());
    assertEquals(true, stream.closed);
  }

  @Test
  public void closeFailurePropagatesInsteadOfReportingSuccess() throws Exception {
    TrackingOutputStream stream = new TrackingOutputStream(true);

    assertThrows(IOException.class,
      () -> SystemBridgePlugin.writeUtf8Stream(stream, "{}"));
  }

  @Test
  public void sanitizesSuggestedNameWithoutDroppingChinese() {
    assertEquals("安心-备份-今日.json",
      SystemBridgePlugin.safeSuggestedName(" 安心/备份\\今日.json "));
    assertEquals("export.json", SystemBridgePlugin.safeSuggestedName(""));
  }

  private static final class TrackingOutputStream extends ByteArrayOutputStream {
    final boolean failOnClose;
    boolean closed;

    TrackingOutputStream(boolean failOnClose) {
      this.failOnClose = failOnClose;
    }

    @Override
    public void close() throws IOException {
      closed = true;
      super.close();
      if (failOnClose) throw new IOException("close failed");
    }
  }
}
