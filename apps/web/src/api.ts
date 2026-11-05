import type {
  JiraBoard,
  JiraConfigBody,
  JiraConfigInfo,
  JiraSprintListItem,
  JiraTestResult,
  Note,
  SprintDetail,
  ActivityEntry,
  AddSourceBody,
  ApplySuggestionsBody,
  CreateProjectBody,
  CreateProjectCdcBody,
  DigestMeetingBody,
  OpenTask,
  ProjectDetail,
  ProjectFields,
  ProjectFile,
  ProjectItem,
  ProjectItemKind,
  ProjectSummary,
  AdjustFileTypeBody,
  CreateFileTypeBody,
  DeskImportResult,
  ListSettings,
  Prestataire,
  PrestataireContactInput,
  PrestataireInput,
  PrestataireUsage,
  SettingsResponse,
  DeskTicket,
  TmaEntry,
  TmaMonthDetail,
  TmaOverview,
  TmaThemesResponse,
  FileSpec,
  FileTypeDetail,
  FileTypeSummary,
  FileTypeVersionInfo,
  CdcDetail,
  CdcDocument,
  CdcSummary,
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

  settings: () => request<SettingsResponse>('GET', '/settings'),
  saveLists: (lists: ListSettings) => request<ListSettings>('PUT', '/settings/lists', lists),
  settingsUsage: () => request<PrestataireUsage>('GET', '/settings/usage'),
  createPrestataire: (b: PrestataireInput) => request<Prestataire>('POST', '/settings/prestataires', b),
  updatePrestataire: (id: string, b: PrestataireInput) => request<Prestataire>('PUT', `/settings/prestataires/${id}`, b),
  deletePrestataire: (id: string) => request<null>('DELETE', `/settings/prestataires/${id}`),
  mergePrestataire: (id: string, intoId: string) => request<Prestataire>('POST', `/settings/prestataires/${id}/merge`, { intoId }),
  importPrestataires: () => request<{ created: number; linked: number }>('POST', '/settings/prestataires/import'),
  addPrestataireContact: (id: string, b: PrestataireContactInput) => request<Prestataire>('POST', `/settings/prestataires/${id}/contacts`, b),
  updatePrestataireContact: (id: string, cid: string, b: PrestataireContactInput) => request<Prestataire>('PUT', `/settings/prestataires/${id}/contacts/${cid}`, b),
  deletePrestataireContact: (id: string, cid: string) => request<Prestataire>('DELETE', `/settings/prestataires/${id}/contacts/${cid}`),

  tmaOverview: () => request<TmaOverview>('GET', '/tma'),
  importDesk: (fileName: string, tickets: DeskTicket[]) => request<DeskImportResult>('POST', '/tma/desk/import', { fileName, tickets }),
  classifyTickets: (all: boolean) => request<JobInfo>('POST', '/tma/desk/classify', { all }),
  tmaThemes: () => request<TmaThemesResponse>('GET', '/tma/themes'),
  tmaMonth: (month: string) => request<TmaMonthDetail>('GET', `/tma/months/${month}`),
  putTmaMonth: (month: string, fileName: string, entries: TmaEntry[]) => request<TmaMonthDetail>('PUT', `/tma/months/${month}`, { fileName, entries }),
  deleteTmaMonth: (month: string) => request<null>('DELETE', `/tma/months/${month}`),
  writeTmaSynthesis: (month: string) => request<JobInfo>('POST', `/tma/months/${month}/synthesis`),
  listProjects: () => request<ProjectSummary[]>('GET', '/projects'),
  getProject: (id: string) => request<ProjectDetail>('GET', `/projects/${id}`),
  createProject: (b: CreateProjectBody) => request<ProjectDetail>('POST', '/projects', b),
  updateProject: (id: string, rev: number, fields: ProjectFields) => request<ProjectDetail>('PUT', `/projects/${id}`, { rev, fields }),
  deleteProject: (id: string) => request<null>('DELETE', `/projects/${id}`),
  createItem: <K extends ProjectItemKind>(id: string, kind: K, data: Record<string, unknown>) =>
    request<ProjectItem<K>>('POST', `/projects/${id}/items/${kind}`, data),
  updateItem: <K extends ProjectItemKind>(id: string, kind: K, itemId: string, patch: Record<string, unknown>) =>
    request<ProjectItem<K>>('PATCH', `/projects/${id}/items/${kind}/${itemId}`, patch),
  deleteItem: (id: string, kind: ProjectItemKind, itemId: string) => request<null>('DELETE', `/projects/${id}/items/${kind}/${itemId}`),
  createProjectFile: (id: string, b: { name: string; category: string; contentType: string; size: number }) =>
    request<{ file: ProjectFile; upload: { url: string; headers: Record<string, string> } }>('POST', `/projects/${id}/files`, b),
  confirmProjectFile: (id: string, fileId: string) => request<ProjectFile>('POST', `/projects/${id}/files/${fileId}/confirm`),
  downloadProjectFile: (id: string, fileId: string) => request<{ url: string; fileName: string }>('GET', `/projects/${id}/files/${fileId}/download`),
  noteSource: (id: string, noteId: string) => request<{ text: string }>('GET', `/projects/${id}/notes/${noteId}/source`),
  applySuggestions: (id: string, noteId: string, b: ApplySuggestionsBody) => request<ProjectDetail>('POST', `/projects/${id}/notes/${noteId}/suggestions`, b),
  digestMeeting: (id: string, b: DigestMeetingBody) => request<JobInfo>('POST', `/projects/${id}/digest`, b),
  progressReport: (id: string) => request<JobInfo>('POST', `/projects/${id}/report`),
  createProjectCdc: (id: string, b: CreateProjectCdcBody) => request<{ id: string; job: JobInfo | null }>('POST', `/projects/${id}/cdcs`, b),
  attachCdc: (cdcId: string, projectId: string | null) => request<CdcDetail>('PATCH', `/cdcs/${cdcId}/project`, { projectId }),
  openTasks: () => request<OpenTask[]>('GET', '/tasks/open'),

  jiraConfig: () => request<JiraConfigInfo>('GET', '/jira/config'),
  saveJiraConfig: (b: JiraConfigBody) => request<{ config: JiraConfigInfo; test: JiraTestResult }>('PUT', '/jira/config', b),
  jiraFields: () => request<JiraTestResult>('GET', '/jira/fields'),
  jiraBoards: (projectKey: string) => request<JiraBoard[]>('GET', `/jira/boards?project=${encodeURIComponent(projectKey)}`),
  jiraSprints: (boardId: number) => request<JiraSprintListItem[]>('GET', `/jira/boards/${boardId}/sprints`),
  syncSprint: (sprintId: number, boardId: number, projectKey: string) => request<SprintDetail>('POST', `/jira/sprints/${sprintId}/sync`, { boardId, projectKey }),
  getSprint: (sprintId: number) => request<SprintDetail>('GET', `/jira/sprints/${sprintId}`),
  writeSprintReview: (sprintId: number) => request<JobInfo>('POST', `/jira/sprints/${sprintId}/compte-rendu`),
  saveSprintReview: (sprintId: number, markdown: string) => request<SprintDetail>('PUT', `/jira/sprints/${sprintId}/compte-rendu`, { markdown }),
  publishSprintReview: (sprintId: number, projectId: string) => request<Note>('POST', `/jira/sprints/${sprintId}/journal`, { projectId }),
  activity: () => request<ActivityEntry[]>('GET', '/activity'),
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
