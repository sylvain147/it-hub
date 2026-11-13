/**
 * Fournisseur simulé, utilisé en développement local et dans les tests : aucune requête réseau, coût nul.
 * Il produit des réponses plausibles à partir des entrées pour pouvoir dérouler tous les parcours.
 */
import type { LlmProvider, LlmUsage, StructuredCall } from './llm.js';
import type { Draft, Extraction, Translation, Update } from './schemas.js';
import type { SpecPatch } from '../filetypes/ai-schemas.js';
import type { SynthesisOutput, ThemesOutput } from '../tma/ai-schemas.js';
import type { SprintDocOutput } from '../sprints/ai-schemas.js';
import type { Digest, Report } from '../projects/ai.js';
import type { AssistantOutput } from '../assistant/routes.js';

const tokens = (s: string) => Math.ceil(s.length / 4);

function between(input: string, tag: string): string {
  const m = new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(input);
  return m?.[1] ?? '';
}

export class MockProvider implements LlmProvider {
  /** Latence simulée (ms), pour voir les écrans d'attente en local. */
  constructor(private delayMs = Number(process.env.MOCK_LLM_DELAY_MS ?? 600)) {}

  async structured<T>(call: StructuredCall<T>): Promise<{ output: T; usage: LlmUsage }> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const output = this.respond(call) as T;
    call.schema.parse(output);
    return {
      output,
      usage: {
        inputTokens: tokens(call.system) + tokens(call.input),
        outputTokens: tokens(JSON.stringify(output)),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }

  private respond(call: StructuredCall<unknown>): unknown {
    switch (call.operation) {
      case 'extraction':
        return this.extraction(call.input);
      case 'redaction':
        return this.draft(call.input);
      case 'traduction':
        return this.translate(call.input);
      case 'projet_compte_rendu':
        return this.digest(call.input);
      case 'projet_rapport':
        return this.report(call.input);
      case 'fichier_brouillon':
        return { settings: guessSettings(excerptOf(call.input)), recordTypes: guessRecordTypes(excerptOf(call.input)), checks: [], remarks: ['Fiche simulée (aucun appel IA).'] };
      case 'fichier_mise_au_point':
      case 'fichier_correction':
      case 'fichier_ajustement':
        return this.filePatch(call.input, call.operation);
      case 'tma_themes':
        return this.themes(call.input);
      case 'tma_synthese':
        return this.tmaSynthesis(call.input);
      case 'assistant':
        return this.assistant(call.context ?? '', call.input);
      case 'sprint_compte_rendu':
        return this.sprintReview(call.input);
      case 'sprint_preparation':
        return this.sprintPreparation(call.input);
      default:
        return this.update(call.input, call.operation);
    }
  }

  /** Réponse simulée : reprend les lignes du contexte utiles à la question (to-do, tickets, jalons, projets cités). */
  private assistant(context: string, input: string): AssistantOutput {
    const question = between(input, 'question').trim();
    const part = (title: string) => {
      const m = new RegExp(`## ${title}[^\\n]*\\n([\\s\\S]*?)(\\n## |$)`).exec(context);
      return (m?.[1] ?? '').split('\n').filter((l) => l.startsWith('- ')).slice(0, 5);
    };
    const joined = between(input, 'pieces_jointes').split('\n').filter(Boolean);
    const focus = [...between(input, 'projets_detailles').matchAll(/^# Projet (.+) \((\/projets\/[^)]+)\)$/gm)].map((m) => `- [${m[1]}](${m[2]})`);
    const blocks = [
      joined.length && `Pièces jointes reçues (non lues en simulation) :\n${joined.map((l) => `- ${l.replace(/^\d+\.\s*/, '')}`).join('\n')}`,
      focus.length && `Projets cités :\n${focus.join('\n')}`,
      part('Ma to-do').length && `**Ma to-do**\n${part('Ma to-do').join('\n')}`,
      part('Mes tickets ouverts').length && `**Mes tickets**\n${part('Mes tickets ouverts').join('\n')}`,
      part('Jalons non atteints').length && `**Échéances**\n${part('Jalons non atteints').join('\n')}`,
    ].filter(Boolean);
    // Texte long (compte rendu collé) : une proposition par phrase d'action (« il faut… », « à faire : … »), sur le premier projet cité.
    const projectId = /\(\/projets\/([^)]+)\)$/m.exec(between(input, 'projets_detailles'))?.[1] ?? '';
    const command = question.length < 200 ? commandAction(question, projectId, context) : null;
    const actions: AssistantOutput['actions'] = command
      ? [command]
      : question.length < 200
        ? []
        : question
            .split(/\n|(?<=\.)\s+/)
            .map((l) => l.replace(/^[-*•\s]+/, '').trim())
            .filter((l) => /^(il faut|à faire|action|todo|relancer|envoyer|corriger|créer|ajouter|prévoir)\b/i.test(l))
            .slice(0, 5)
            .map((l, i) => ({
              kind: /^(relancer|envoyer)/i.test(l) ? 'todo' : 'ticket',
              ticket: '',
              status: '',
              title: l.replace(/^(il faut|à faire|action|todo)\s*:?\s*/i, '').replace(/\.$/, '').slice(0, 120) || l,
              ticketType: '',
              details: '',
              projectId,
              dueDate: '',
              priority: i === 0 ? 'haute' : 'normale',
              assigneeId: '',
              reason: 'Phrase d’action du texte (simulation)',
            }));
    return {
      answer: `${actions.length ? `Après analyse (simulation), je vais ${actions.map((x) => (x.kind === 'ticket_update' ? `mettre à jour ${x.ticket}` : `créer « ${x.title || x.projectId} »`)).join(', ')}.\n\n` : ''}*Réponse simulée (aucun appel IA) à : « ${question.slice(0, 200)} »*\n\n${blocks.join('\n\n') || 'Rien à signaler dans les données du hub.'}`,
      followUps: ['Quels projets sont en retard ?', 'Où en est le sprint en cours ?'],
      actions,
    };
  }

  private extraction(input: string): Extraction {
    const text = between(input, 'transcription');
    const lines = text
      .split(/\n+/)
      .map((l) => l.replace(/^[^:]{1,30}:\s*/, '').trim())
      .filter((l) => l.length > 15);
    const title = /Titre donné par l'utilisateur : (.*)/.exec(input)?.[1];
    return {
      titre: title && title !== '(aucun)' ? title : (lines[0] ?? 'Nouveau sujet').slice(0, 80),
      prestataire: /prestataire\s+(\w+)/i.exec(text)?.[1] ?? '',
      phase: null,
      jalons: [],
      estimationJours: null,
      notes: `## Contexte\n${lines.slice(0, 3).map((l) => `- ${l}`).join('\n')}\n\n## Demandes et besoins\n${lines
        .slice(3, 25)
        .map((l) => `- ${l}`)
        .join('\n')}`,
    };
  }

  private draft(input: string): Draft {
    const notes = `${between(input, 'notes_de_reunion')}\n${between(input, 'fiche_projet')}`;
    const part = (title: string) => {
      const m = new RegExp(`## ${title}\\n([\\s\\S]*?)(\\n## |$)`).exec(notes);
      return m?.[1]?.trim() || '- [À préciser]';
    };
    const known = /Titre : (.*)/.exec(input)?.[1];
    return {
      title: known && known !== '(à proposer)' ? known : 'Cahier des charges (simulation)',
      prestataire: '',
      phase: 'cadrage',
      jalons: [{ label: 'Mise en production', date: '' }],
      estimationJours: null,
      sections: [
        { kind: 'contexte', title: 'Contexte', markdown: `*Texte généré en mode simulation (aucun appel IA).*\n\n${part('Contexte')}` },
        { kind: 'standard', title: 'Enjeux', markdown: '[À préciser]' },
        {
          kind: 'standard',
          title: 'Périmètre du développement',
          markdown: `## Développements demandés au prestataire\n\n${part('Demandes et besoins')}`,
        },
      ],
      questions: [
        { text: 'Quel est le prestataire en charge du développement ?', why: 'Le prestataire n’est pas cité.', priority: 'bloquante', sectionTitle: 'Périmètre du développement' },
        { text: 'Quelle est la date de mise en production visée ?', why: 'Aucune échéance datée.', priority: 'bloquante', sectionTitle: 'Contexte' },
        { text: 'Quel est l’impact financier si l’échéance n’est pas tenue ?', why: 'La section Enjeux est vide.', priority: 'importante', sectionTitle: 'Enjeux' },
      ],
    };
  }

  private update(input: string, operation: string): Update {
    const sections = [...between(input, 'sections_fournies').matchAll(/<section id="([^"]+)" kind="[^"]+" title="([^"]*)">\n([\s\S]*?)\n<\/section>/g)];
    const target = sections.at(-1) ?? sections[0];
    const answers = between(input, 'reponses_du_charge_de_projet');
    const consigne = between(input, 'consigne');
    const notes = between(input, 'nouvelles_notes_de_reunion');
    const addition = answers
      ? `\n\n**Précisions apportées :**\n${answers
          .split('\n')
          .filter((l) => l.trim().startsWith('Réponse'))
          .map((l) => `- ${l.replace(/^\s*Réponse : /, '')}`)
          .join('\n')}`
      : consigne
        ? `\n\n*(Simulation : section retravaillée selon la consigne « ${consigne.split('\n').at(-1)} ».)*`
        : `\n\n**Compléments issus de la nouvelle réunion :**\n${notes.split('\n').filter((l) => l.startsWith('- ')).slice(0, 8).join('\n')}`;
    const open = [...between(input, 'questions_ouvertes').matchAll(/- \[([^\]]+)\]/g)].map((m) => m[1]!);
    return {
      summary: `Simulation : ${operation.replace(/_/g, ' ')}`,
      sectionChanges: target ? [{ sectionId: target[1]!, title: target[2]!.replace(/&quot;/g, '"'), markdown: target[3]! + addition, insertAfterSectionId: '' }] : [],
      meta: { prestataire: null, phase: null, jalons: null, estimationJours: null },
      newQuestions: [],
      resolvedQuestionIds: notes ? open.slice(0, 1) : [],
    };
  }

  private filePatch(input: string, operation: string): SpecPatch {
    const empty = /<fiche_actuelle>\n\(vide/.test(input);
    if (empty) {
      const excerpt = excerptOf(input);
      return { settings: guessSettings(excerpt), upsertRecordTypes: guessRecordTypes(excerpt), removeRecordTypes: [], checks: null, summary: 'Fiche simulée créée à partir de l’extrait', remarks: ['Fiche simulée (aucun appel IA) : vérifiez les champs.'] };
    }
    const first = /## \[([^\]]+)\] ([^—]+) —/.exec(input);
    const demande = between(input, 'demande');
    return {
      settings: null,
      upsertRecordTypes: [],
      removeRecordTypes: [],
      checks: null,
      summary: operation === 'fichier_ajustement' ? `Simulation : ajustement demandé (« ${demande.slice(0, 60)} »)${first ? ` ; premier type ${first[1]}` : ''}` : 'Simulation : fiche vérifiée',
      remarks: [],
    };
  }

  /** Thème simulé d'après quelques mots-clés du sujet. */
  private themes(input: string): ThemesOutput {
    const rules: [RegExp, string][] = [
      [/ch[eè]que/i, 'Chèques – erreur de montant / impayé'],
      [/paypal|paiement/i, 'Paiements – à rattacher'],
      [/rembours/i, 'Remboursements – non déclenchés'],
      [/annul/i, 'Annulations de commandes ou d’articles'],
    ];
    return {
      items: [...between(input, 'tickets').matchAll(/^### #(\d+) — (.*)$/gm)].map((m) => ({
        id: m[1]!,
        theme: rules.find(([re]) => re.test(m[2]!))?.[1] ?? 'Autres demandes',
      })),
    };
  }

  private sprintPreparation(input: string): SprintDocOutput {
    const data = between(input, 'preparation_du_sprint');
    const lines = data.split('\n');
    const head = lines.filter((l) => l.startsWith('- ')).slice(0, 3);
    const planned = lines.slice(lines.findIndex((l) => l.startsWith('## Tickets prévus')) + 1).filter((l) => /^- [A-Z][A-Z0-9_]*-\d+/.test(l)).slice(0, 6);
    const alerts = lines.filter((l) => /^- \[(critique|attention|info)\]/.test(l)).map((l) => l.replace(/^- \[\w+\] /, '- '));
    return {
      markdown: `## Objectif proposé\n\n*Préparation simulée (aucun appel IA).*\n\n## Périmètre et capacité\n\n${head.join('\n')}\n\n## Reports et arbitrages\n\n${planned.join('\n') || '- Aucun ticket prévu'}\n\n## Points à clarifier avant le lancement\n\n${alerts.join('\n') || '- Aucun'}\n\n## Ordre du jour de la réunion de planification\n\n- [À compléter]`,
    };
  }

  private sprintReview(input: string): SprintDocOutput {
    const data = between(input, 'chiffres_du_sprint');
    const facts = data.split('\n').filter((l) => l.startsWith('- ')).slice(0, 5);
    const alerts = data.split('\n').filter((l) => /^- \[(critique|attention)\]/.test(l)).slice(0, 4).map((l) => l.replace(/^- \[\w+\] /, '- '));
    return {
      markdown: `## Message clé\n\n*Compte rendu simulé (aucun appel IA).*\n\n## Faits marquants\n\n${facts.join('\n')}\n\n## Risques et points d'attention\n\n${alerts.join('\n') || '- Aucun'}\n\n## Pistes pour le prochain sprint\n\n- [À compléter]`,
    };
  }

  private tmaSynthesis(input: string): SynthesisOutput {
    const facts = between(input, 'chiffres_du_mois')
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .slice(0, 4);
    return { markdown: `## En bref\n\n*Synthèse simulée (aucun appel IA).*\n\n${facts.join('\n')}\n\n## Points d'attention et recommandations\n\n- [À compléter]` };
  }

  private digest(input: string): Digest {
    const lines = between(input, 'transcription')
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 10);
    const speaker = (l: string) => /^([^:]{1,30}):/.exec(l)?.[1] ?? '';
    const actions = lines.filter((l) => /\b(doit|faut|va|envoyer|faire)\b/i.test(l)).slice(0, 3);
    const dates = lines.filter((l) => /\b(prod|recette|livraison|testing)\b/i.test(l)).slice(0, 1);
    // Ticket cité (« T-12 ») avec un mot d'état : mise à jour proposée.
    const ticketUpdates = lines.flatMap((l) => {
      const key = /\bT-(\d+)\b/.exec(l)?.[0];
      const status = /termin|fini|livr[ée] en prod/i.test(l) ? 'termine' : /recette/i.test(l) ? 'recette' : /attente|bloqu/i.test(l) ? 'attente' : /commenc|en cours|démarr/i.test(l) ? 'en_cours' : '';
      return key && status ? [{ ticket: key, status: status as Digest['ticketUpdates'][number]['status'], dueDate: '', priority: '' as const, reason: l.replace(/^[^:]{1,30}:\s*/, '').slice(0, 200) }] : [];
    });
    const tasks = actions.map((l) => ({ title: l.replace(/^[^:]{1,30}:\s*/, '').slice(0, 120), assignee: speaker(l), dueDate: '', priority: 'normale' as const }));
    const plan = [
      tasks.length && `créer ${tasks.length > 1 ? 'les tickets' : 'le ticket'} ${tasks.map((t) => `« ${t.title} »`).join(', ')}`,
      ticketUpdates.length && `mettre à jour ${ticketUpdates.map((u) => u.ticket).join(', ')}`,
      dates.length && 'ajouter un jalon',
    ].filter(Boolean);
    return {
      plan: plan.length ? `Après analyse (simulation), je vais ${plan.join(', ')}.` : 'Après analyse (simulation), rien à créer ni à mettre à jour.',
      ticketUpdates,
      title: 'Réunion (simulation)',
      summary: `*Compte rendu simulé (aucun appel IA).*\n\n## Points abordés\n${lines.slice(0, 6).map((l) => `- ${l.replace(/^[^:]{1,30}:\s*/, '')}`).join('\n')}`,
      decisions: lines.filter((l) => /\b(on part sur|décid|valid)/i.test(l)).map((l) => l.replace(/^[^:]{1,30}:\s*/, '')),
      tasks,
      jalons: dates.map((l) => ({ label: l.replace(/^[^:]{1,30}:\s*/, '').slice(0, 80), date: '' })),
      risks: lines.some((l) => /retard|risque/i.test(l)) ? [{ title: 'Risque de retard évoqué en réunion', probability: 'moyen' as const, impact: 'moyen' as const, mitigation: '' }] : [],
    };
  }

  private report(input: string): Report {
    const data = between(input, 'donnees_projet');
    const late = /EN RETARD/.test(data);
    const section = (t: string) => new RegExp(`## ${t}\\n([\\s\\S]*?)(\\n## |$)`).exec(data)?.[1]?.trim() ?? '(aucun)';
    return {
      title: `Rapport d’avancement du ${/Date du jour : (\S+)/.exec(data)?.[1] ?? ''}`,
      markdown: `*Rapport simulé (aucun appel IA).*\n\n## Synthèse\n${late ? 'Des retards sont à signaler.' : 'Le projet avance comme prévu.'}\n\n## Réalisé\n${section('Tâches terminées depuis 30 jours')}\n\n## En cours et à venir\n${section('Tâches ouvertes')}\n\n## Points d'attention\n${section('Risques ouverts')}`,
      suggestedHealth: late ? 'orange' : 'vert',
    };
  }

  private translate(input: string): Translation {
    const lang = /Langue cible : (\w+)/.exec(input)?.[1] === 'allemand' ? 'DE' : 'EN';
    const items = JSON.parse(between(input, 'elements')) as { key: string; text: string }[];
    return {
      items: items.map((i) => ({
        key: i.key,
        // Préfixe chaque ligne de texte sans casser images ni tableaux.
        text: i.text
          .split('\n')
          .map((l) => (l.trim() && !l.startsWith('![') && !l.startsWith('|') ? l.replace(/^(\s*(?:[-*]|\d+\.|#+|>)?\s*)/, `$1[${lang}] `) : l))
          .join('\n'),
      })),
    };
  }
}

/** Lignes de l'extrait (numéros de ligne retirés). */
function excerptOf(input: string): string[] {
  const block = /<extrait[^>]*>\n?([\s\S]*?)\n?<\/extrait>/.exec(input)?.[1] ?? '';
  return block.split('\n').map((l) => l.replace(/^\s*\d+│/, '')).filter((l) => l.trim());
}

function guessSettings(excerpt: string | string[]) {
  const lines = Array.isArray(excerpt) ? excerpt : excerpt.split('\n').map((l) => l.replace(/^\s*\d+│/, ''));
  const delimited = lines.length > 0 && lines.every((l) => l.includes(';'));
  return { format: delimited ? ('delimited' as const) : ('fixed' as const), encoding: 'utf-8' as const, delimiter: ';', quote: '"', skipLines: 0, fileNamePattern: '' };
}

/** Heuristique simple : le début de ligne (8 caractères) sert de code de type. */
function guessRecordTypes(lines: string[]): SpecPatch['upsertRecordTypes'] {
  const base = { description: '', impliedDecimals: 0, dateFormat: '', values: [], hidden: false };
  if (lines.length && lines.every((l) => l.includes(';'))) {
    const cols = lines[0]!.split(';').length;
    return [{ code: 'ligne', name: 'Ligne', description: '', role: 'detail', match: [], parent: null, fields: Array.from({ length: cols }, (_, i) => ({ ...base, key: `colonne_${i + 1}`, label: `Colonne ${i + 1}`, start: i + 1, length: 0, type: 'text' as const })) }];
  }
  const width = Math.min(8, ...lines.map((l) => l.length));
  const groups = new Map<string, number>();
  for (const l of lines) groups.set(l.slice(0, width), Math.max(groups.get(l.slice(0, width)) ?? 0, l.length));
  if (groups.size > 20 || width < 1) {
    const max = Math.max(...lines.map((l) => l.length));
    return [{ code: 'ligne', name: 'Ligne', description: '', role: 'detail', match: [], parent: null, fields: [{ ...base, key: 'contenu', label: 'Contenu', start: 1, length: max, type: 'text' }] }];
  }
  return [...groups.entries()].map(([code, max]) => ({
    code: code.trim() || 'vide',
    name: `Ligne ${code.trim()}`,
    description: '',
    role: 'other' as const,
    match: [{ start: 1, length: width, value: code }],
    parent: null,
    fields: [
      { ...base, key: 'code', label: 'Code', start: 1, length: width, type: 'code' as const },
      ...(max > width ? [{ ...base, key: 'contenu', label: 'Contenu', start: width + 1, length: max - width, type: 'text' as const }] : []),
    ],
  }));
}

/**
 * Demande courte de création (« Crée-moi un ticket sur la poste, essentiel, pour le développement ») : une proposition,
 * sur le premier projet cité, avec le type de ticket et la priorité déduits des mots de la demande (simulation).
 */
function commandAction(question: string, projectId: string, context: string): AssistantOutput['actions'][number] | null {
  const q = question.toLowerCase();
  // « Passe T-12 en recette » : mise à jour d'un ticket existant.
  const key = /\bt-(\d+)\b/.exec(q)?.[0];
  const status = /termin|fini/.test(q) ? 'termine' : /recette/.test(q) ? 'recette' : /attente|bloqu/.test(q) ? 'attente' : /en cours|commenc/.test(q) ? 'en_cours' : '';
  if (key && status) return { kind: 'ticket_update', ticket: key.toUpperCase(), status, title: '', ticketType: '', details: '', projectId: '', dueDate: '', priority: '', assigneeId: '', reason: 'Demande de mise à jour (simulation)' };
  if (!/^\s*(cr[ée]e|ajoute|mets|met|planifie|rappelle|note|programme)/.test(q)) return null;
  const kind = /\bjalon\b/.test(q) ? 'jalon' : /\bticket\b/.test(q) ? 'ticket' : /to-?do|t[âa]che|rappelle/.test(q) ? 'todo' : null;
  if (!kind) return null;
  const types = (/## Types de tickets\n([^\n]*)/.exec(context)?.[1] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const words: [RegExp, string][] = [[/d[ée]v/, 'dev'], [/recette|test/, 'recette'], [/cadrage/, 'cadrage'], [/mep|mise en prod/, 'mep'], [/correct|bug/, 'correctif']];
  const ticketType = kind === 'ticket' ? (types.find((t) => words.some(([re, k]) => re.test(q) && t.toLowerCase() === k)) ?? '') : '';
  const projectName = projectId ? (new RegExp(`\\[([^\\]]+)\\]\\(/projets/${projectId}\\)`).exec(context)?.[1] ?? '') : '';
  const priority = /critique|bloquant/.test(q) ? 'critique' : /important|urgent|prioritaire/.test(q) ? 'haute' : 'normale';
  const title = ticketType ? projectName : question.replace(/^\s*\S+(\s+moi)?\s+(un|une|le|la)?\s*(ticket|t[âa]che|jalon|to-?do)?\s*/i, '').slice(0, 120) || question;
  return { kind, ticket: '', status: '', title: title || question, ticketType, details: '', projectId, dueDate: '', priority, assigneeId: '', reason: 'Demande de création (simulation)' };
}
