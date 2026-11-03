/**
 * Fournisseur simulé, utilisé en développement local et dans les tests : aucune requête réseau, coût nul.
 * Il produit des réponses plausibles à partir des entrées pour pouvoir dérouler tous les parcours.
 */
import type { LlmProvider, LlmUsage, StructuredCall } from './llm.js';
import type { Draft, Extraction, Translation, Update } from './schemas.js';

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
      default:
        return this.update(call.input, call.operation);
    }
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
    const notes = between(input, 'notes_de_reunion');
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
