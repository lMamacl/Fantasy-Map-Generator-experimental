// Reading and writing local files, plus naming downloads and exports.

import { ensureEl } from "./nodeUtils";

/** Build a filename from the map name, optional type and current time */
export function getFileName(dataType?: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  const date = new Date();
  const dateString = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes())
  ].join("-");

  const rawName = (ensureEl<HTMLInputElement>("mapName")?.value || "Fantasy Map").trim();
  const sanitizedName = rawName.replace(/[/\\?%*:|"<>]/g, "_").trim() || "Fantasy Map";

  const type = dataType ? `${dataType} ` : "";
  return `${sanitizedName} ${type}${dateString}`;
}

/** Download data as a file using native File System Access API or Data URI fallback */
export async function downloadFile(data: BlobPart, name: string, type = "application/octet-stream"): Promise<void> {
  // Use Native File System Access API if available in browser
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ".map";
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: name,
        types: [
          {
            description: "Fantasy Map File",
            accept: { "application/octet-stream": [ext, ".map"] }
          }
        ]
      });
      const writable = await handle.createWritable();
      const content = typeof data === "string" ? data : data instanceof Blob ? await data.text() : data;
      await writable.write(content);
      await writable.close();
      return;
    } catch (err: any) {
      if (err.name === "AbortError") return; // User cancelled save dialog
    }
  }

  // Reliable Fallback for browsers without File System Access API
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else {
    blob = new Blob([data], { type });
  }

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = name;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => window.URL.revokeObjectURL(url), 10000);
}

/** Read the selected file as text and pass its content to the callback */
export function uploadFile(input: HTMLInputElement, callback: (data: string) => void): void {
  const file = input.files?.[0];
  if (!file) return;

  const fileReader = new FileReader();
  fileReader.readAsText(file, "UTF-8");
  input.value = "";
  fileReader.onload = loaded => callback(loaded.target?.result as string);
}
