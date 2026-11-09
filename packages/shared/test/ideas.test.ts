import { describe, expect, it } from 'vitest';
import { parseIdeasImport, priorityFromText, statusFromText } from '../src/ideas.js';

describe('import des idées depuis Notion', () => {
  it('reconnaît les priorités et statuts usuels', () => {
    expect(priorityFromText('Haute')).toBe('haute');
    expect(priorityFromText('🔥 Urgent')).toBe('critique');
    expect(priorityFromText('⭐⭐⭐')).toBe('haute');
    expect(priorityFromText('P3')).toBe('basse');
    expect(priorityFromText('Moyenne')).toBe('normale');
    expect(priorityFromText('Très élevée')).toBe('critique');
    expect(priorityFromText('???')).toBeNull();
    expect(statusFromText('Done')).toBe('realisee');
    expect(statusFromText('Not started')).toBe('nouvelle');
    expect(statusFromText('En cours')).toBe('en_cours');
    expect(statusFromText('Abandonné')).toBe('ecartee');
  });

  it('lit un export CSV de Notion et garde les autres colonnes dans la description', () => {
    const csv = '﻿Name,Priorité,Statut,Description,Créé le,Demandé par\n"Export des commandes, en Excel",Haute,À faire,"Depuis la liste\ndes commandes",9 novembre 2026,Logistique\nRaccourci fiche client,Basse,,,,\n,Haute,,,,\nAlerte stock,Bof,Done,,,';
    const r = parseIdeasImport(csv);
    expect(r.columns).toMatchObject({ title: 'Name', priority: 'Priorité', status: 'Statut', details: 'Description' });
    expect(r.ideas).toHaveLength(3);
    expect(r.ideas[0]).toMatchObject({ title: 'Export des commandes, en Excel', priority: 'haute', status: 'retenue', domain: 'ERP' });
    expect(r.ideas[0]!.details).toBe('Depuis la liste\ndes commandes\n\n**Demandé par** : Logistique');
    expect(r.ideas[1]).toMatchObject({ priority: 'basse', status: 'nouvelle', details: '' });
    expect(r.ideas[2]).toMatchObject({ priority: 'normale', status: 'realisee' });
    expect(r.unknownPriorities).toEqual(['Bof']);
  });

  it('lit un tableau copié-collé (tabulations) avec une colonne de domaine', () => {
    const r = parseIdeasImport('Idée\tImportance\tModule\nSaisie rapide des avoirs\tCritique\tCompta\n', 'ERP');
    expect(r.ideas).toEqual([expect.objectContaining({ title: 'Saisie rapide des avoirs', priority: 'critique', domain: 'Compta' })]);
  });

  it('lit une liste à puces ou à cocher', () => {
    const r = parseIdeasImport('# Idées amélioration ERP\n- [ ] Export Excel (haute)\n- [x] Logo sur les factures\n* 🔥🔥🔥🔥 Bug de TVA\n1. Recherche par code postal — basse\nSans puce', 'ERP');
    expect(r.ideas.map((i) => [i.title, i.priority, i.status])).toEqual([
      ['Idées amélioration ERP', 'normale', 'nouvelle'],
      ['Export Excel', 'haute', 'nouvelle'],
      ['Logo sur les factures', 'normale', 'realisee'],
      ['Bug de TVA', 'critique', 'nouvelle'],
      ['Recherche par code postal', 'basse', 'nouvelle'],
      ['Sans puce', 'normale', 'nouvelle'],
    ]);
  });
});
