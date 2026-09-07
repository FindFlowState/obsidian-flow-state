import { App, Modal } from "obsidian";
import qrcode from "qrcode-generator";

/**
 * "Get the app" modal: QR code to the download page plus a link to the web
 * app, so desktop users can pick whichever is closer at hand.
 *
 * ⚠️ User-facing copy — follow the Flowstate voice guides before editing.
 */
export class GetAppModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("fs-getapp-modal");
    const { titleEl, contentEl } = this;
    titleEl.setText("Get the Flowstate app");

    contentEl.createEl("p", {
      text: "Snap handwritten pages or record voice memos on your phone, and send them straight to this vault.",
      cls: "fs-ob-tagline",
    });

    const qrWrap = contentEl.createDiv({ cls: "fs-getapp-qr" });
    try {
      const qr = qrcode(0, "M");
      qr.addData("https://seekflowstate.com");
      qr.make();
      qrWrap.createEl("img", {
        attr: { src: qr.createDataURL(4, 8), alt: "QR code for seekflowstate.com" },
        cls: "fs-getapp-qr-img",
      });
    } catch { /* QR is a nicety; the links below still work */ }
    qrWrap.createDiv({ text: "Scan with your phone's camera", cls: "fs-qr-caption" });

    const links = contentEl.createDiv({ cls: "fs-getapp-links" });
    const dl = links.createEl("p");
    dl.appendText("Download links live at ");
    dl.createEl("a", { text: "seekflowstate.com", href: "https://seekflowstate.com" });
    dl.appendText(".");
    const web = links.createEl("p");
    web.appendText("Prefer a browser? ");
    web.createEl("a", { text: "Open the web app →", href: "https://app.startflow.ing" });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
