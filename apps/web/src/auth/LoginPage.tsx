import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { confirmResetPassword, confirmSignIn, resetPassword, signIn, type SignInOutput } from 'aws-amplify/auth';
import QRCode from 'qrcode';
import { DEV_USER_KEY, runtimeConfig } from '../config';
import { Spinner } from '../components/ui';
import { Brand } from '../components/Brand';

const RECENT_KEY = 'hub-dev-recent';
const PASSWORD_HINT = '12 caractères au moins, avec une minuscule, une majuscule et un chiffre.';

/** Page de connexion : e-mail + mot de passe, puis code de l'application d'authentification (MFA obligatoire). */
export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">
          <Brand />
        </div>
        {runtimeConfig().authMode === 'cognito' ? <CognitoLogin onSignedIn={onSignedIn} /> : <DevLogin onSignedIn={onSignedIn} />}
      </div>
      <p className="auth-foot">Accès réservé à l’équipe informatique. Un compte est créé par un administrateur du hub.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Développement local : pas de Cognito
// ---------------------------------------------------------------------------

function DevLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  const [email, setEmail] = useState(recent[0] ?? '');

  function go(e: string) {
    const v = e.trim().toLowerCase();
    if (!v) return;
    localStorage.setItem(DEV_USER_KEY, v);
    localStorage.setItem(RECENT_KEY, JSON.stringify([v, ...recent.filter((x) => x !== v)].slice(0, 6)));
    onSignedIn();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(email);
      }}
    >
      <h1>Connexion</h1>
      <div className="alert alert-info small">
        Mode développement : pas de mot de passe ni de double authentification. Le premier compte utilisé devient administrateur ; les autres sont ajoutés
        comme chargés de projet.
      </div>
      <label className="field">
        <span>Adresse e-mail</span>
        <input className="input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@entreprise.fr" />
      </label>
      <button className="btn btn-primary btn-block mt" disabled={!email.trim()}>Se connecter</button>
      {recent.length > 0 && (
        <div className="mt">
          <div className="muted small">Comptes récents</div>
          <div className="auth-recent">
            {recent.map((r) => (
              <button key={r} type="button" className="btn btn-sm" onClick={() => go(r)}>{r}</button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Production : Cognito (MFA TOTP obligatoire)
// ---------------------------------------------------------------------------

type Step =
  | { kind: 'identifiants' }
  | { kind: 'nouveau_mdp' }
  | { kind: 'totp_setup'; uri: string; secret: string }
  | { kind: 'totp' }
  | { kind: 'oubli' }
  | { kind: 'oubli_code'; destination: string };

/** Message d'erreur Cognito en français. */
function frError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  switch (err.name) {
    case 'NotAuthorizedException':
      if (/disabled/i.test(err.message ?? '')) return 'Votre compte est désactivé. Contactez un administrateur du hub.';
      if (/temporary password has expired/i.test(err.message ?? '')) return 'Le mot de passe temporaire a expiré : demandez à un administrateur de renvoyer l’invitation.';
      if (/session/i.test(err.message ?? '')) return 'La session de connexion a expiré : recommencez.';
      return 'Adresse e-mail ou mot de passe incorrect.';
    case 'UserNotFoundException':
      return 'Adresse e-mail ou mot de passe incorrect.';
    case 'CodeMismatchException':
    case 'EnableSoftwareTokenMFAException':
      return 'Code incorrect. Vérifiez l’heure de votre téléphone et saisissez le code affiché maintenant.';
    case 'ExpiredCodeException':
      return 'Ce code a expiré : demandez-en un nouveau.';
    case 'InvalidPasswordException':
      return `Mot de passe trop faible : ${PASSWORD_HINT}`;
    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return 'Trop de tentatives : patientez quelques minutes avant de réessayer.';
    case 'UserAlreadyAuthenticatedException':
      return 'Vous êtes déjà connecté : rechargez la page.';
    default:
      return err.message || 'Connexion impossible. Réessayez.';
  }
}

function CognitoLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'identifiants' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  /** Étape suivante indiquée par Cognito. */
  async function next(out: SignInOutput) {
    const s = out.nextStep;
    setCode('');
    switch (s.signInStep) {
      case 'DONE':
        onSignedIn();
        return;
      case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
        setPassword('');
        setStep({ kind: 'nouveau_mdp' });
        return;
      case 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP':
        setStep({ kind: 'totp_setup', uri: s.totpSetupDetails.getSetupUri('Hobbit', email).toString(), secret: s.totpSetupDetails.sharedSecret });
        return;
      case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
        setStep({ kind: 'totp' });
        return;
      case 'CONTINUE_SIGN_IN_WITH_MFA_SELECTION':
      case 'CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION':
        await next(await confirmSignIn({ challengeResponse: 'TOTP' }));
        return;
      case 'RESET_PASSWORD':
        await forgot();
        return;
      default:
        throw new Error(`Étape de connexion non prise en charge (${s.signInStep}). Contactez un administrateur.`);
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(frError(e));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    const r = await resetPassword({ username: email.trim().toLowerCase() });
    const dest = r.nextStep.resetPasswordStep === 'CONFIRM_RESET_PASSWORD_WITH_CODE' ? (r.nextStep.codeDeliveryDetails.destination ?? 'votre adresse e-mail') : 'votre adresse e-mail';
    setPassword('');
    setPassword2('');
    setCode('');
    setStep({ kind: 'oubli_code', destination: dest });
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    switch (step.kind) {
      case 'identifiants':
        return void run(async () => next(await signIn({ username: email.trim().toLowerCase(), password })));
      case 'nouveau_mdp':
        if (password !== password2) return setError('Les deux mots de passe ne sont pas identiques.');
        return void run(async () => next(await confirmSignIn({ challengeResponse: password })));
      case 'totp_setup':
      case 'totp':
        return void run(async () => next(await confirmSignIn({ challengeResponse: code.replace(/\s/g, '') })));
      case 'oubli':
        return void run(forgot);
      case 'oubli_code':
        if (password !== password2) return setError('Les deux mots de passe ne sont pas identiques.');
        return void run(async () => {
          await confirmResetPassword({ username: email.trim().toLowerCase(), confirmationCode: code.trim(), newPassword: password });
          setPassword('');
          setStep({ kind: 'identifiants' });
          setInfo('Mot de passe modifié : connectez-vous avec le nouveau mot de passe.');
        });
    }
  };

  const back = (
    <button type="button" className="btn btn-link" onClick={() => { setError(null); setStep({ kind: 'identifiants' }); }}>
      ← Retour à la connexion
    </button>
  );

  let body: ReactNode;
  switch (step.kind) {
    case 'identifiants':
      body = (
        <>
          <h1>Connexion</h1>
          {info && <div className="alert alert-info small">{info}</div>}
          <label className="field">
            <span>Adresse e-mail</span>
            <input className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Mot de passe</span>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn btn-primary btn-block mt" disabled={busy || !email.trim() || !password}>{busy && <Spinner small />} Se connecter</button>
          <button type="button" className="btn btn-link mt" onClick={() => { setError(null); setInfo(null); setStep({ kind: 'oubli' }); }}>Mot de passe oublié ?</button>
        </>
      );
      break;
    case 'nouveau_mdp':
      body = (
        <>
          <h1>Choisissez votre mot de passe</h1>
          <p className="muted small">Première connexion : remplacez le mot de passe temporaire reçu par e-mail. {PASSWORD_HINT}</p>
          <PasswordFields password={password} password2={password2} setPassword={setPassword} setPassword2={setPassword2} />
          <button className="btn btn-primary btn-block mt" disabled={busy || !password}>{busy && <Spinner small />} Continuer</button>
        </>
      );
      break;
    case 'totp_setup':
      body = (
        <>
          <h1>Double authentification</h1>
          <p className="muted small">
            Le hub demande, à chaque connexion, un code à six chiffres. Installez une application d’authentification (Google Authenticator, Microsoft
            Authenticator…), scannez ce QR code, puis saisissez le code affiché.
          </p>
          <QrCode uri={step.uri} />
          <details className="small">
            <summary>Impossible de scanner ? Saisir la clé à la main</summary>
            <code className="auth-secret">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          </details>
          <CodeField code={code} setCode={setCode} />
          <button className="btn btn-primary btn-block mt" disabled={busy || code.replace(/\s/g, '').length < 6}>{busy && <Spinner small />} Activer et se connecter</button>
          {back}
        </>
      );
      break;
    case 'totp':
      body = (
        <>
          <h1>Code de vérification</h1>
          <p className="muted small">Saisissez le code à six chiffres affiché par votre application d’authentification.</p>
          <CodeField code={code} setCode={setCode} />
          <button className="btn btn-primary btn-block mt" disabled={busy || code.replace(/\s/g, '').length < 6}>{busy && <Spinner small />} Valider</button>
          {back}
        </>
      );
      break;
    case 'oubli':
      body = (
        <>
          <h1>Mot de passe oublié</h1>
          <p className="muted small">Indiquez votre adresse e-mail : vous recevrez un code pour choisir un nouveau mot de passe.</p>
          <label className="field">
            <span>Adresse e-mail</span>
            <input className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn btn-primary btn-block mt" disabled={busy || !email.trim()}>{busy && <Spinner small />} Recevoir un code</button>
          {back}
        </>
      );
      break;
    case 'oubli_code':
      body = (
        <>
          <h1>Nouveau mot de passe</h1>
          <p className="muted small">Un code a été envoyé à {step.destination}. {PASSWORD_HINT}</p>
          <label className="field">
            <span>Code reçu par e-mail</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <PasswordFields password={password} password2={password2} setPassword={setPassword} setPassword2={setPassword2} />
          <button className="btn btn-primary btn-block mt" disabled={busy || !code.trim() || !password}>{busy && <Spinner small />} Changer le mot de passe</button>
          {back}
        </>
      );
      break;
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert alert-error small">{error}</div>}
      {body}
    </form>
  );
}

function PasswordFields(p: { password: string; password2: string; setPassword: (v: string) => void; setPassword2: (v: string) => void }) {
  return (
    <>
      <label className="field">
        <span>Nouveau mot de passe</span>
        <input className="input" type="password" autoComplete="new-password" autoFocus value={p.password} onChange={(e) => p.setPassword(e.target.value)} />
      </label>
      <label className="field">
        <span>Confirmation</span>
        <input className="input" type="password" autoComplete="new-password" value={p.password2} onChange={(e) => p.setPassword2(e.target.value)} />
      </label>
    </>
  );
}

function CodeField({ code, setCode }: { code: string; setCode: (v: string) => void }) {
  return (
    <label className="field">
      <span>Code à six chiffres</span>
      <input className="input auth-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} />
    </label>
  );
}

function QrCode({ uri }: { uri: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(uri, { margin: 1, width: 200 }).then(setSrc, () => setSrc(''));
  }, [uri]);
  return <div className="auth-qr">{src ? <img src={src} alt="QR code à scanner avec l’application d’authentification" width={200} height={200} /> : <Spinner />}</div>;
}
