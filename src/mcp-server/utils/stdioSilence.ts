// src/mcp-server/utils/stdioSilence.ts

import { config } from "../../config/index.js";

/**
 * Belirtilen bir asenkron fonksiyonu, yalnızca MCP_TRANSPORT_TYPE='stdio' ise
 * tüm stdout ve stderr çıktılarını geçici olarak susturarak çalıştırır.
 * Hata oluşsa bile orijinal akışları geri yüklemeyi garanti eder.
 *
 * @param operationToSilence Yürütülecek asenkron fonksiyon.
 * @returns Fonksiyonun dönüş değerini döndürür.
 * @template T Fonksiyonun dönüş tipi.
 */
export async function executeUnderStdioSilence<T>(
  operationToSilence: () => Promise<T>
): Promise<T> {
  if (config.mcpTransportType !== "stdio") {
    // stdio modunda değilsek hiçbir şey yapma, direkt çalıştır.
    return operationToSilence();
  }

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  try {
    // Tüm çıktıları engelle
    process.stdout.write = () => true;
    process.stderr.write = () => true;

    // Asıl işlemi çalıştır
    return await operationToSilence();
  } finally {
    // Hata olsa bile orijinal fonksiyonları geri yükle
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}