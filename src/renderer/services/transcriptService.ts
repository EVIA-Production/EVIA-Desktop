import { BACKEND_URL } from '../config/config';

interface DeleteTranscriptParams {
  chatId: number;
  transcriptId: number;
  token: string;
  baseUrl?: string;
}

export async function deleteTranscript({
  chatId,
  transcriptId,
  token,
  baseUrl,
}: DeleteTranscriptParams): Promise<void> {
  const url = baseUrl || BACKEND_URL;
  const endpoint = `${url.replace(/\/$/, '')}/chat/${chatId}/transcripts/${transcriptId}`;

  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok && response.status !== 204) {
    const detail = await response.text();
    throw new Error(detail || `Failed to delete transcript (HTTP ${response.status})`);
  }
}

