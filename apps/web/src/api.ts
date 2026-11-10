import type {
  AssistantAnswer,
  AssistantAskBody,
  MePreferences,
  Feedback,
  FeedbackInput,
  Idea,
  IdeaInput,
  ImportIdeasBody,
  UpdateIdeaBody,
  UpdateFeedbackBody,
  SprintDocKind,
  SprintPromptExport,
  Note,
  SprintDetail,
  Sprint,
  SprintInput,
  CreateSprintBody,
  SprintsOverview,
  HubUser,
  Me,
  PersonalTask,
  PersonalNote,
  PersonalNoteInput,
  PlanningProject,
  TodoInput,
  TodoOrderBody,
  BoutonRougeScores,
  TodosResponse,
  UserInput,
  UserUpdate,
  ActivityEntry,
  AddSourceBody,
  ApplySuggestionsBody,
  CreateProjectBody,
  CreateProjectCdcBody,
  DigestMeetingBody,
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
  DeskTicketInfo,
  TmaEntry,
  TmaMonthDetail,
  TmaMonthImportResult,
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

/** Évènement émis à chaque modification de la to-do (pastille du bouton « To-do », listes ouvertes). */
export const TODOS_CHANGED = 'hub:todos-changed';
function todosChanged<T>(r: T): T {
  window.dispatchEvent(new Event(TODOS_CHANGED));
  return r;
}

export const api = {
  me: () => request<Me>('GET', '/me'),
  /** Préférences personnelles (thème de couleur). */
  setPreferences: (b: MePreferences) => request<Me>('PUT', '/me/preferences', b),

  users: () => request<HubUser[]>('GET', '/users'),
  createUser: (b: UserInput) => request<{ user: HubUser; linkedTasks: number }>('POST', '/users', b),
  updateUser: (email: string, b: UserUpdate) => request<HubUser>('PUT', `/users/${encodeURIComponent(email)}`, b),
  resendInvitation: (email: string) => request<HubUser>('POST', `/users/${encodeURIComponent(email)}/invitation`),
  todos: (user?: string) => request<TodosResponse>('GET', `/todos${user ? `?user=${encodeURIComponent(user)}` : ''}`),
  projectTodos: (projectId: string) => request<TodosResponse>('GET', `/todos?projet=${encodeURIComponent(projectId)}`),
  createTodo: (b: TodoInput) => request<PersonalTask>('POST', '/todos', b).then(todosChanged),
  updateTodo: (id: string, patch: Partial<TodoInput>) => request<PersonalTask>('PATCH', `/todos/${id}`, patch).then(todosChanged),
  deleteTodo: (id: string) => request<null>('DELETE', `/todos/${id}`).then(todosChanged),
  /** Nouvel ordre de la to-do (glisser-déposer). */
  reorderTodos: (ids: string[]) => request<null>('PUT', '/todos/ordre', { ids } satisfies TodoOrderBody),
  /** Notes : les miennes par défaut ; `user` (e-mail ou « all ») réservé aux administrateurs. */
  notes: (q: { projectId?: string; user?: string } = {}) =>
    request<PersonalNote[]>('GET', `/notes?${new URLSearchParams({ ...(q.projectId ? { projet: q.projectId } : {}), ...(q.user ? { user: q.user } : {}) }).toString()}`),
  createNote: (b: PersonalNoteInput & { ownerId?: string }) => request<PersonalNote>('POST', '/notes', b),
  updateNote: (n: Pick<PersonalNote, 'id' | 'ownerId'>, patch: Partial<PersonalNoteInput>) => request<PersonalNote>('PATCH', `/notes/${n.id}?owner=${encodeURIComponent(n.ownerId)}`, patch),
  deleteNote: (n: Pick<PersonalNote, 'id' | 'ownerId'>) => request<null>('DELETE', `/notes/${n.id}?owner=${encodeURIComponent(n.ownerId)}`),
  /** Assistant : une question (et les derniers échanges), une réponse. Chaque appel consomme de l'IA. */
  askAssistant: (b: AssistantAskBody) => request<AssistantAnswer>('POST', '/assistant', b),
  boutonRouge: () => request<BoutonRougeScores>('GET', '/bouton-rouge'),
  clicBoutonRouge: () => request<BoutonRougeScores>('POST', '/bouton-rouge/clic'),

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
  deskTicket: (id: string) => request<DeskTicketInfo>('GET', `/tma/desk/tickets/${encodeURIComponent(id)}`),
  importDesk: (fileName: string, tickets: DeskTicket[]) => request<DeskImportResult>('POST', '/tma/desk/import', { fileName, tickets }),
  classifyTickets: (all: boolean) => request<JobInfo>('POST', '/tma/desk/classify', { all }),
  tmaThemes: () => request<TmaThemesResponse>('GET', '/tma/themes'),
  tmaMonth: (month: string) => request<TmaMonthDetail>('GET', `/tma/months/${month}`),
  putTmaMonth: (month: string, fileName: string, entries: TmaEntry[]) => request<TmaMonthImportResult>('PUT', `/tma/months/${month}`, { fileName, entries }),
  deleteTmaMonth: (month: string) => request<null>('DELETE', `/tma/months/${month}`),
  writeTmaSynthesis: (month: string) => request<JobInfo>('POST', `/tma/months/${month}/synthesis`),
  listProjects: () => request<ProjectSummary[]>('GET', '/projects'),
  planning: () => request<PlanningProject[]>('GET', '/projects/jalons'),
  getProject: (id: string) => request<ProjectDetail>('GET', `/projects/${id}`),
  createProject: (b: CreateProjectBody) => request<ProjectDetail>('POST', '/projects', b),
  updateProject: (id: string, rev: number, fields: ProjectFields) => request<ProjectDetail>('PUT', `/projects/${id}`, { rev, fields }),
  deleteProject: (id: string) => request<null>('DELETE', `/projects/${id}`),
  followProject: (id: string, follow: boolean) => request<{ followers: string[] }>('PUT', `/projects/${id}/suivi`, { follow }),
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

  sprints: () => request<SprintsOverview>('GET', '/sprints'),
  planProject: (sprintId: number, projectId: string) => request<{ planned: number }>('POST', `/sprints/${sprintId}/plan-project`, { projectId }),
  createSprint: (b: CreateSprintBody) => request<Sprint>('POST', '/sprints', b),
  updateSprint: (sprintId: number, b: SprintInput) => request<SprintDetail>('PUT', `/sprints/${sprintId}`, b),
  startSprint: (sprintId: number) => request<SprintDetail>('POST', `/sprints/${sprintId}/start`),
  closeSprint: (sprintId: number, moveTo: number | null) => request<{ moved: number; detail: SprintDetail }>('POST', `/sprints/${sprintId}/close`, { moveTo }),
  /** Classe comme sprint passé un sprint à venir dont la fin est dépassée. */
  pastSprint: (sprintId: number, moveTo: number | null) => request<{ moved: number; detail: SprintDetail }>('POST', `/sprints/${sprintId}/past`, { moveTo }),
  deleteSprint: (sprintId: number) => request<null>('DELETE', `/sprints/${sprintId}`),
  getSprint: (sprintId: number) => request<SprintDetail>('GET', `/sprints/${sprintId}`),
  writeSprintDoc: (sprintId: number, kind: SprintDocKind) => request<JobInfo>('POST', `/sprints/${sprintId}/documents/${kind}`),
  saveSprintDoc: (sprintId: number, kind: SprintDocKind, markdown: string) => request<SprintDetail>('PUT', `/sprints/${sprintId}/documents/${kind}`, { markdown }),
  publishSprintDoc: (sprintId: number, kind: SprintDocKind, projectId: string) => request<Note>('POST', `/sprints/${sprintId}/documents/${kind}/journal`, { projectId }),
  sprintDocPrompt: (sprintId: number, kind: SprintDocKind) => request<SprintPromptExport>('GET', `/sprints/${sprintId}/documents/${kind}/prompt`),
  sprintDocWord: (sprintId: number, kind: SprintDocKind) => request<{ url: string; fileName: string }>('POST', `/sprints/${sprintId}/documents/${kind}/word`),
  ideas: () => request<Idea[]>('GET', '/idees'),
  createIdea: (b: IdeaInput) => request<Idea>('POST', '/idees', b),
  updateIdea: (id: string, b: UpdateIdeaBody) => request<Idea>('PATCH', `/idees/${id}`, b),
  deleteIdea: (id: string) => request<null>('DELETE', `/idees/${id}`),
  voteIdea: (id: string, vote: boolean) => request<Idea>('PUT', `/idees/${id}/vote`, { vote }),
  importIdeas: (b: ImportIdeasBody) => request<{ created: number; skipped: number }>('POST', '/idees/import', b),
  ideaTicket: (id: string, projectId: string) => request<Idea>('POST', `/idees/${id}/ticket`, { projectId }),
  sendFeedback: (b: FeedbackInput) => request<Feedback>('POST', '/feedback', b),
  listFeedback: () => request<Feedback[]>('GET', '/feedback'),
  updateFeedback: (id: string, b: UpdateFeedbackBody) => request<Feedback>('PATCH', `/feedback/${id}`, b),
  deleteFeedback: (id: string) => request<null>('DELETE', `/feedback/${id}`),
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
