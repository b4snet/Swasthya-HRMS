/**
 * Malware-scanning hook (ADR-011 §2): an INJECTED async check run before a
 * Document row is created. The default implementation is an honest no-op —
 * the prompt forbids claiming scanning is complete when no scanner exists,
 * so every comment/log here says exactly that. A ClamAV/VirusTotal
 * implementation slots in later without schema or service changes.
 */

export interface ScanInput {
  content: Uint8Array;
  contentType: string;
  fileName: string; // sanitized display name only
}

export interface ScanResult {
  clean: boolean;
  /** Set when clean === false; safe, client-displayable reason. */
  reason?: string;
  /** Scanner identity for audit payloads (e.g. "clamav-1.2"). */
  scanner: string;
}

export interface DocumentScanHook {
  readonly scanner: string;
  scan(input: ScanInput): Promise<ScanResult>;
}

/** Documented NO-OP: reports clean and says so by name. */
export class NoOpScanHook implements DocumentScanHook {
  readonly scanner = "noop-scan-disabled";

  async scan(_input: ScanInput): Promise<ScanResult> {
    // Honest posture: NO malware scanning is performed. `scanner` is stored
    // on the audit payload so deployments can prove which hook ran.
    return { clean: true, scanner: this.scanner };
  }
}
