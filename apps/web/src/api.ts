import type {
  AddSourceBody,
  AdjustFileTypeBody,
  CreateFileTypeBody,
  FileSpec,
  FileTypeDetail,
  FileTypeSummary,
  FileTypeVersionInfo,
  CdcDetail,
  CdcDocument,
  CdcSummary,
  CreateCdcBody,
  ExportBody,
  JobInfo,
  Question,
  SourceInfo,
  TranslationInfo,
  TranslationLanguage,
  UpdateQuestionBody,
  UsageReport,
  VersionInfo,
} from '@samm/shared';
import { authHeaders } from './auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = data as { error?: string; details?: unknown } | null;
    throw new ApiError(res.status, err?.error ?? `Erreur ${res.status}`, err?.details);
  }
  return data as T;
}

export const api = {
  me: () => request<{ email: string; llm: string }>('GET', '/me'),

  listCdcs: () => request<CdcSummary[]>('GET', '/cdcs'),
  createCdc: (b: CreateCdcBody) => request<{ id: string; job: JobInfo | null }>('POST', '/cdcs', b),
  getCdc: (id: string) => request<CdcDetail>('GET', `/cdcs/${id}`),
  saveCdc: (id: string, baseSeq: number, document: CdcDocument, comment: string) =>
    request<{ version: VersionInfo; detail: CdcDetail }>('PUT', `/cdcs/${id}`, { baseSeq, document, comment }),

  listVersions: (id: string) => request<VersionInfo[]>('GET', `/cdcs/${id}/versions`),
  getVersion: (id: string, seq: number) => request<{ info: VersionInfo; document: CdcDocument }>('GET', `/cdcs/${id}/versions/${seq}`),
  restoreVersion: (id: string, seq: number, baseSeq: number) =>
    request<{ version: VersionInfo; detail: CdcDetail }>('POST', `/cdcs/${id}/versions/${seq}/restore`, { baseSeq }),

  listQuestions: (id: string) => request<Question[]>('GET', `/cdcs/${id}/questions`),
  updateQuestion: (id: string, qid: string, b: UpdateQuestionBody) => request<Question>('PATCH', `/cdcs/${id}/questions/${qid}`, b),
  integrateAnswers: (id: string, baseSeq: number) => request<JobInfo>('POST', `/cdcs/${id}/questions/integrate`, { baseSeq }),

  listSources: (id: string) => request<SourceInfo[]>('GET', `/cdcs/${id}/sources`),
  sourceText: (id: string, sid: string) => request<string>('GET', `/cdcs/${id}/sources/${sid}/text`),
  addSource: (id: string, b: AddSourceBody) => request<JobInfo>('POST', `/cdcs/${id}/sources`, b),

  reworkSection: (id: string, sectionId: string, baseSeq: number, instruction: string) =>
    request<JobInfo>('POST', `/cdcs/${id}/sections/${sectionId}/rework`, { baseSeq, instruction }),

  listTranslations: (id: string) => request<TranslationInfo[]>('GET', `/cdcs/${id}/translations`),
  translate: (id: string, lang: TranslationLanguage) => request<JobInfo>('POST', `/cdcs/${id}/translations`, { lang }),

  exportCdc: (id: string, b: ExportBody) => request<{ url: string; fileName: string }>('POST', `/cdcs/${id}/exports`, b),

  createAsset: (id: string, contentType: string, size: number) =>
    request<{ ref: string; upload: { url: string; headers: Record<string, string> } }>('POST', `/cdcs/${id}/assets`, { contentType, size }),
  resolveAssets: (refs: string[]) => request<Record<string, string>>('POST', '/assets/resolve', { refs }),

  getJob: (id: string) => request<JobInfo>('GET', `/jobs/${id}`),

  listFileTypes: () => request<FileTypeSummary[]>('GET', '/filetypes'),
  getFileType: (id: string) => request<FileTypeDetail>('GET', `/filetypes/${id}`),
  createFileType: (b: CreateFileTypeBody) => request<{ id: string; job: JobInfo }>('POST', '/filetypes', b),
  renameFileType: (id: string, name: string, description: string) => request<FileTypeDetail>('PATCH', `/filetypes/${id}`, { name, description }),
  deleteFileType: (id: string) => request<null>('DELETE', `/filetypes/${id}`),
  saveFileTypeSpec: (id: string, baseSeq: number, spec: FileSpec, comment: string) =>
    request<{ version: FileTypeVersionInfo; detail: FileTypeDetail }>('PUT', `/filetypes/${id}/spec`, { baseSeq, spec, comment }),
  adjustFileType: (id: string, b: AdjustFileTypeBody) => request<JobInfo>('POST', `/filetypes/${id}/adjust`, b),
  retryFileType: (id: string) => request<JobInfo>('POST', `/filetypes/${id}/retry`),
  listFileTypeVersions: (id: string) => request<FileTypeVersionInfo[]>('GET', `/filetypes/${id}/versions`),
  restoreFileTypeVersion: (id: string, seq: number, baseSeq: number) =>
    request<{ version: FileTypeVersionInfo; detail: FileTypeDetail }>('POST', `/filetypes/${id}/versions/${seq}/restore`, { baseSeq }),
  usage: (month: string) => request<UsageReport>('GET', `/usage?month=${month}`),
};

/** Attend la fin d'une tâche IA en interrogeant l'API. */
export async function waitForJob(id: string, onUpdate: (j: JobInfo) => void, signal?: AbortSignal): Promise<JobInfo> {
  for (;;) {
    if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
    const job = await api.getJob(id);
    onUpdate(job);
    if (job.status === 'termine' || job.status === 'erreur') return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Téléchargement d'un fichier exporté. */
export function download(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
