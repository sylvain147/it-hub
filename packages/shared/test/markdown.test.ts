import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc, docToPlainText } from '../src/markdown.js';
import { nextVersionNumber } from '../src/cdc.js';

describe('markdown <-> riche', () => {
  it('convertit titres, listes, gras, tableaux et images aller-retour', () => {
    const md = [
      '## Base de données',
      '',
      'Paramétrage du mode **ESS** « La Poste *Essentiel* ».',
      '',
      '- Table `EVE`',
      '- Tables de référence',
      '  - sous-point',
      '',
      '1. Convertir la commande',
      '2. Conserver le mode',
      '',
      '| TYPE | POIDS |',
      '| --- | --- |',
      '| T1 | 190,00 |',
      '',
      '![capture Soneeet](asset:abc/def)',
    ].join('\n');
    const doc = markdownToDoc(md);
    expect(doc.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(doc.content?.find((n) => n.type === 'table')).toBeTruthy();
    expect(doc.content?.find((n) => n.type === 'image')).toMatchObject({ attrs: { src: 'asset:abc/def' } });
    const back = docToMarkdown(doc);
    expect(back).toContain('## Base de données');
    expect(back).toContain('**ESS**');
    expect(back).toContain('*Essentiel*');
    expect(back).toContain('- Table `EVE`');
    expect(back).toContain('  - sous-point');
    expect(back).toContain('2. Conserver le mode');
    expect(back).toContain('| T1 | 190,00 |');
    expect(back).toContain('![capture Soneeet](asset:abc/def)');
    // stable au second passage
    expect(docToMarkdown(markdownToDoc(back))).toBe(back);
  });

  it('échappe les caractères Markdown du texte saisi', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'prix * 2 et a_b' }] }] };
    const md = docToMarkdown(doc);
    expect(docToPlainText(markdownToDoc(md))).toBe('prix * 2 et a_b');
  });

  it('les titres de niveau 1 deviennent des sous-sections', () => {
    const doc = markdownToDoc('# Titre');
    expect(doc.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });
});

describe('numérotation des versions', () => {
  it('commence à 0.1 puis passe en 1.0 à la validation', () => {
    const v1 = nextVersionNumber(null, 'brouillon');
    expect(v1).toEqual({ major: 0, minor: 1 });
    const v2 = nextVersionNumber({ ...v1, status: 'brouillon' }, 'brouillon');
    expect(v2).toEqual({ major: 0, minor: 2 });
    const v3 = nextVersionNumber({ ...v2, status: 'brouillon' }, 'valide');
    expect(v3).toEqual({ major: 1, minor: 0 });
    const v4 = nextVersionNumber({ ...v3, status: 'valide' }, 'valide');
    expect(v4).toEqual({ major: 1, minor: 1 });
    const v5 = nextVersionNumber({ ...v4, status: 'valide' }, 'envoye');
    expect(v5).toEqual({ major: 2, minor: 0 });
  });
});
