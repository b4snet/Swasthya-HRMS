/**
 * Document download route (Phase 3, prompt 3) — the ONLY byte read path.
 *
 * Security posture (ADR-011 §2):
 * - Session-resolved caller; no public or signed URLs exist. A request
 *   without a session gets 401/403 — never a redirect to a file.
 * - All authorization (tenant, org reach, classification gate, download
 *   capability) happens inside downloadDocument; this handler maps its
 *   stable error codes onto HTTP statuses and leaks nothing else.
 * - Bytes stream as `attachment` so browsers download rather than render
 *   (no XSS-through-upload surface).
 * - The storage id is opaque and never appears in any response or log.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { callerFromUser } from "@/modules/workforce/service/caller";
import { downloadDocument } from "@/modules/documents/service/document-service";
import { DocumentsAppError } from "@/modules/documents/service/app-errors";
import { DOCUMENTS_ERROR_STATUS } from "@/modules/documents/service/app-errors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in to download documents." } },
      { status: 401 },
    );
  }
  const { id } = await params;
  const caller = callerFromUser(user);

  try {
    const result = await downloadDocument(caller, undefined, id);
    const safeName = result.title.replace(/[^A-Za-z0-9._ ()-]/g, "_").slice(0, 120) || "document";
    const extension = extensionFor(result.contentType);
    return new NextResponse(result.content as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${safeName}${extension}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof DocumentsAppError) {
      const status = DOCUMENTS_ERROR_STATUS[err.code] ?? 500;
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
    }
    console.error("[documents] download failure", err);
    return NextResponse.json(
      { error: { code: "UNEXPECTED", message: "The request could not be completed." } },
      { status: 500 },
    );
  }
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    default:
      return "";
  }
}
