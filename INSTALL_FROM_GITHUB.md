# Installer ClawPort depuis GitHub

Ce guide explique comment installer et lancer ClawPort UI depuis le code source GitHub.

## Prérequis

- Node.js 22+
- OpenClaw installé
- Une gateway OpenClaw fonctionnelle

## 1) Cloner ton fork GitHub

```bash
git clone https://github.com/Newluc2/clawport-ui.git
cd clawport-ui
```

## 2) Installer les dépendances

```bash
npm install
```

## 3) Configurer l'environnement

Lance l’assistant de setup pour détecter automatiquement ta config OpenClaw et créer `.env.local` :

```bash
npm run setup
```

Variables attendues :
- `WORKSPACE_PATH`
- `OPENCLAW_BIN`
- `OPENCLAW_GATEWAY_TOKEN`
- (optionnel) `OPENCLAW_GATEWAY_PORT`

## 4) Vérifier / démarrer OpenClaw

Dans un autre terminal :

```bash
openclaw gateway status
openclaw gateway run
```

## 5) Démarrer ClawPort

```bash
npm run dev
```

Puis ouvre :

- http://localhost:3000

## Commandes utiles

```bash
npm test
npx tsc --noEmit
npm run build
```

## Notes

- Si le chat retourne une erreur 405, active l’endpoint OpenAI dans `~/.openclaw/openclaw.json` :
  - `gateway.http.endpoints.chatCompletions.enabled = true`
- Redémarre la gateway après modification de config.

