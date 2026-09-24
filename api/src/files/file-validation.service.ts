import { Injectable } from "@nestjs/common";
import AdmZip from "adm-zip";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { UploadErrorDetail } from "./upload-error.js";

export type AcceptedFileType = "EXCEL" | "PDF";

export interface ValidatedUpload {
  file: Express.Multer.File;
  fileType: AcceptedFileType;
  sanitizedFilename: string;
  mimeType: string;
}

@Injectable()
export class FileValidationService {
  async validate(file: Express.Multer.File): Promise<ValidatedUpload | UploadErrorDetail> {
    const sanitizedFilename = this.sanitizeFilename(file.originalname);
    const extension = extname(sanitizedFilename).toLowerCase();

    if (!extension || (extension !== ".pdf" && extension !== ".xlsx")) {
      return this.error("FILE_INVALID", `Unsupported file extension for ${sanitizedFilename}. Only .xlsx and .pdf are accepted.`, sanitizedFilename);
    }

    if (file.size === 0) {
      return this.error("FILE_EMPTY", `${sanitizedFilename} is empty.`, sanitizedFilename);
    }

    if (extension === ".pdf") {
      const header = await this.readPrefix(file.path, 5);
      if (header.toString("ascii") !== "%PDF-") {
        return this.error("FILE_CORRUPTED", `${sanitizedFilename} does not contain a valid PDF signature.`, sanitizedFilename);
      }
      return { file, fileType: "PDF", sanitizedFilename, mimeType: "application/pdf" };
    }

    if (!this.isXlsxContainer(file.path)) {
      return this.error("FILE_CORRUPTED", `${sanitizedFilename} is not a valid XLSX container.`, sanitizedFilename);
    }
    return {
      file,
      fileType: "EXCEL",
      sanitizedFilename,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    };
  }

  sanitizeFilename(originalFilename: string): string {
    const base = basename(originalFilename.replace(/\\/g, "/"));
    const cleaned = base
      .replace(/[\x00-\x1F\x7F]/g, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "upload";
  }

  private async readPrefix(filePath: string, length: number): Promise<Buffer> {
    const data = await readFile(filePath);
    return data.subarray(0, length);
  }

  private isXlsxContainer(filePath: string): boolean {
    try {
      const archive = new AdmZip(filePath);
      const entries = new Set(archive.getEntries().map((entry) => entry.entryName));
      return entries.has("[Content_Types].xml") && entries.has("_rels/.rels") && entries.has("xl/workbook.xml");
    } catch {
      return false;
    }
  }

  private error(errorCode: UploadErrorDetail["errorCode"], message: string, filename: string): UploadErrorDetail {
    return { errorCode, message, details: { filename, field: "files" } };
  }
}
