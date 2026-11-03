import { useState } from 'react';
import type { JobInfo, Question } from '@samm/shared';
import { api } from '../api';
import { EmptyState, PriorityBadge, shortUser, toast } from '../components/ui';

interface Props {
  cdcId: string;
  questions: Question[];
  setQuestions: (qs: Question[]) => void;
  baseSeq: number;
  aiDisabledReason: string | null;
  onJob: (j: JobInfo) => void;
  onGoToSection: (sectionId: string) => void;
}

const PRIORITY_ORDER = { bloquante: 0, importante: 1, optionnelle: 2 };

export function QuestionsPanel({ cdcId, questions, setQuestions, baseSeq, aiDisabledReason, onJob, onGoToSection }: Props) {
  const [showDone, setShowDone] = useState(false);
  const active = questions
    .filter((q) => q.status === 'ouverte' || q.status === 'repondue')
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.createdAt.localeCompare(b.createdAt));
  const done = questions.filter((q) => q.status === 'integree' || q.status === 'ignoree');
  const answered = questions.filter((q) => q.status === 'repondue' && q.answer.trim());

  async function update(q: Question, patch: { answer?: string; status?: Question['status'] }) {
    try {
      const updated = await api.updateQuestion(cdcId, q.id, patch);
      setQuestions(questions.map((x) => (x.id === q.id ? updated : x)));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function integrate() {
    try {
      onJob(await api.integrateAnswers(cdcId, baseSeq));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="panel-body">
      <p className="muted small">
        Les questions de l’assistant pour compléter le cahier des charges. Répondez à celles que vous pouvez, puis intégrez les réponses : seules
        les sections concernées sont réécrites.
      </p>
      {active.length === 0 ? (
        <EmptyState>Aucune question en attente.</EmptyState>
      ) : (
        active.map((q) => <QuestionCard key={q.id} q={q} onUpdate={update} onGoToSection={onGoToSection} />)
      )}
      <div className="sticky-foot">
        <button className="btn btn-primary btn-block" disabled={!answered.length || !!aiDisabledReason} title={aiDisabledReason ?? ''} onClick={integrate}>
          ✨ Intégrer {answered.length > 1 ? `les ${answered.length} réponses` : answered.length === 1 ? 'la réponse' : 'les réponses'} au CDC
        </button>
      </div>
      {done.length > 0 && (
        <div className="done-block">
          <button className="btn-link" onClick={() => setShowDone(!showDone)}>
            {showDone ? '▾' : '▸'} Questions traitées ({done.length})
          </button>
          {showDone &&
            done.map((q) => (
              <div key={q.id} className="question question-done">
                <div className="q-text">{q.text}</div>
                {q.answer && <div className="q-answer">→ {q.answer}</div>}
                <div className="q-foot">
                  <span className="muted small">{q.status === 'integree' ? 'Intégrée au CDC' : 'Ignorée'}</span>
                  <button className="btn-link small" onClick={() => update(q, { status: q.answer.trim() ? 'repondue' : 'ouverte' })}>Rouvrir</button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function QuestionCard({ q, onUpdate, onGoToSection }: { q: Question; onUpdate: (q: Question, p: { answer?: string; status?: Question['status'] }) => Promise<void>; onGoToSection: (id: string) => void }) {
  const [answer, setAnswer] = useState(q.answer);
  const dirty = answer !== q.answer;
  return (
    <div className={`question${q.status === 'repondue' ? ' question-answered' : ''}`}>
      <div className="q-head">
        <PriorityBadge priority={q.priority} />
        {q.sectionId ? (
          <button className="btn-link small" onClick={() => onGoToSection(q.sectionId!)}>{q.sectionTitle}</button>
        ) : (
          <span className="muted small">{q.sectionTitle}</span>
        )}
      </div>
      <div className="q-text">{q.text}</div>
      {q.why && <div className="q-why">{q.why}</div>}
      <textarea
        className="input q-input"
        rows={2}
        placeholder="Votre réponse…"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onBlur={() => dirty && void onUpdate(q, { answer })}
      />
      <div className="q-foot">
        <span className="muted small">{q.status === 'repondue' ? `Répondue par ${shortUser(q.answeredBy)} — à intégrer` : dirty ? 'Non enregistrée' : ''}</span>
        <button className="btn-link small" onClick={() => onUpdate(q, { status: 'ignoree' })}>Ignorer</button>
      </div>
    </div>
  );
}
