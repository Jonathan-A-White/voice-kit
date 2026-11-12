// How Send recording gets the files off the phone (mw-rdpwdp1.11): the Web Share API with files where the phone has it
// (he picks Postern or mail), else a download. Only called from a tap on Send recording.

export type SentHow = 'shared' | 'downloaded' | 'cancelled';

/** The part of `navigator` the share uses. */
export interface Sharer {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

/** Shares `files`, or hands them to `download` when the browser cannot share files or sharing fails. 'cancelled' when he closes the sheet. */
export async function sendFiles(files: File[], sharer: Sharer, download: (files: File[]) => void): Promise<SentHow> {
  const data: ShareData = { files, title: 'Hey Lampas tries' };
  if (typeof sharer.share === 'function' && typeof sharer.canShare === 'function' && sharer.canShare(data)) {
    try {
      await sharer.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      // any other failure: the files are still on the phone, so give them by download
    }
  }
  download(files);
  return 'downloaded';
}

/** Downloads each file through a temporary link. */
export function downloadFiles(files: File[]): void {
  files.forEach((file, i) => {
    setTimeout(() => {
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, i * 300);
  });
}
