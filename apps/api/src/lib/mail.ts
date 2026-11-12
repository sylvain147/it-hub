/**
 * Envoi d'e-mails : Amazon SES en production (expéditeur `MAIL_FROM`, adresse vérifiée dans SES) ; en local, l'e-mail
 * est écrit dans `<LOCAL_DATA_DIR>/emails` (et son sujet noté dans la console) pour pouvoir suivre le lien.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config } from '../config.js';
import { newId } from './util.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let ses: SESv2Client | null = null;

/** Envoie l'e-mail. Renvoie false si aucun envoi n'est configuré (local) ; lève une erreur si SES refuse. */
export async function sendMail(m: Mail): Promise<boolean> {
  if (config.runtime === 'aws' && config.mailFrom) {
    ses ??= new SESv2Client({ region: config.sesRegion });
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: config.mailFrom,
        Destination: { ToAddresses: [m.to] },
        Content: { Simple: { Subject: { Data: m.subject, Charset: 'UTF-8' }, Body: { Text: { Data: m.text, Charset: 'UTF-8' }, Html: { Data: m.html, Charset: 'UTF-8' } } } },
      }),
    );
    return true;
  }
  if (config.runtime === 'local' && !process.env.VITEST) {
    const dir = join(config.localDataDir, 'emails');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${newId()}.html`), `<!-- À : ${m.to} — ${m.subject} -->\n${m.html}`);
    console.log(`[e-mail local] à ${m.to} : ${m.subject}`);
  }
  return false;
}

/** Échappement HTML d'un texte saisi par l'utilisateur. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
