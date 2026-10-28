'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Chart,
  Diagram,
  Drawer,
  Loader,
  Menu,
  Popup,
  Slider,
  Surface,
  Switch,
  Tabs,
  TextField,
  Tooltip,
  useDrawer,
  useToast,
  type DiagramNode,
} from '@/components/ui';

type Job = { id: number; name: string; progress: number; status: 'queue' | 'running' | 'done'; quality: string };
type Project = { id: number; name: string; meta: string; tag: string };

const COMMENTS = [
  { who: 'Inès M.', t: 'il y a 4 min', text: 'La réfraction sur le verre du plan 14 est parfaite. On garde.' },
  { who: 'Karim B.', t: 'il y a 12 min', text: 'Le grain est un peu fort sur les bords, on peut le baisser de 10 % ?' },
  { who: 'Léa D.', t: 'il y a 31 min', text: 'Étalonnage validé côté client. Il reste la fumée du plan 22.' },
  { who: 'Tom R.', t: 'il y a 1 h', text: 'Le rendu final passe en 38 min sur la nouvelle ferme.' },
  { who: 'Inès M.', t: 'il y a 2 h', text: 'J’ai remplacé la HDRI : les reflets en bandes ressortent mieux.' },
  { who: 'Sara K.', t: 'il y a 3 h', text: 'Pensez à exporter en 16 bits pour la composition.' },
  { who: 'Karim B.', t: 'hier', text: 'Version 3 en ligne. Les cous de matière sont beaucoup plus propres.' },
  { who: 'Léa D.', t: 'hier', text: 'Je regarde la fumée ce soir et je valide.' },
];

const WEEK = [
  { label: 'L', rendus: 14, gpu: 22 },
  { label: 'M', rendus: 22, gpu: 31 },
  { label: 'M', rendus: 18, gpu: 28 },
  { label: 'J', rendus: 31, gpu: 44 },
  { label: 'V', rendus: 27, gpu: 40 },
  { label: 'S', rendus: 12, gpu: 19 },
  { label: 'D', rendus: 9, gpu: 14 },
];
const MONTH = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].map((label, i) => ({
  label,
  rendus: [88, 104, 97, 131, 119, 142, 126, 151][i],
  gpu: [120, 148, 140, 190, 171, 205, 188, 220][i],
}));
const LOAD = ['08h', '10h', '12h', '14h', '16h', '18h', '20h', '22h'].map((label, i) => ({ label, charge: [32, 58, 71, 84, 92, 76, 49, 28][i] }));
const SPLIT = [
  { label: 'Cinéma', part: 48 },
  { label: 'Publicité', part: 27 },
  { label: 'Jeu', part: 15 },
  { label: 'Autre', part: 10 },
];

const fmtPct = (v: number) => `${Math.round(v * 100)} %`;

export default function Console() {
  const router = useRouter();
  const toast = useToast();
  const drawer = useDrawer();

  const [jobs, setJobs] = useState<Job[]>([
    { id: 1, name: 'Aurora — plan 14', progress: 0.62, status: 'running', quality: 'Final' },
    { id: 2, name: 'Mercure — fumée', progress: 0.18, status: 'running', quality: 'Standard' },
    { id: 3, name: 'Atelier — sol mouillé', progress: 0, status: 'queue', quality: 'Brouillon' },
  ]);
  const [projects, setProjects] = useState<Project[]>([
    { id: 1, name: 'Aurora', meta: '14 plans · rendu il y a 4 min', tag: 'Cinéma' },
    { id: 2, name: 'Mercure', meta: '22 plans · rendu il y a 1 h', tag: 'Publicité' },
    { id: 3, name: 'Atelier', meta: '9 plans · rendu hier', tag: 'Jeu' },
    { id: 4, name: 'Lagune', meta: '31 plans · rendu hier', tag: 'Cinéma' },
  ]);

  // Nouveau rendu (Popup lié au bouton)
  const newBtn = useRef<HTMLButtonElement>(null);
  const [popup, setPopup] = useState(false);
  const [name, setName] = useState('');
  const [quality, setQuality] = useState('standard');
  const [samples, setSamples] = useState(512);
  const [denoise, setDenoise] = useState(true);

  // Suppression (Alert)
  const [toDelete, setToDelete] = useState<Project | null>(null);

  // Activité
  const [range, setRange] = useState('7j');

  // Réglages rapides
  const [auto, setAuto] = useState(true);
  const [priority, setPriority] = useState(0.7);
  const [folder, setFolder] = useState('/rendus/aurora');
  const [comment, setComment] = useState('');
  const [syncing, setSyncing] = useState(false);
  const sync = useCallback(() => {
    setSyncing(true);
    window.setTimeout(() => {
      setSyncing(false);
      toast({ title: 'Ferme synchronisée', description: '12 nœuds disponibles', tone: 'success' });
    }, 2400);
  }, [toast]);

  // Simulation de la file : avance les rendus, lance les suivants, notifie à la fin.
  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const cur = jobsRef.current;
      const finished: Job[] = [];
      let running = cur.filter((j) => j.status === 'running').length;
      const next = cur.map((j) => {
        if (j.status === 'running') {
          const p = Math.min(1, j.progress + 0.018 + Math.random() * 0.03);
          if (p >= 1) {
            const done: Job = { ...j, progress: 1, status: 'done' };
            finished.push(done);
            running--;
            return done;
          }
          return { ...j, progress: p };
        }
        if (j.status === 'queue' && running < 2) {
          running++;
          return { ...j, status: 'running' as const };
        }
        return j;
      });
      setJobs(next);
      finished.forEach((j) => toast({ title: 'Rendu terminé', description: j.name, tone: 'success' }));
    }, 700);
    return () => window.clearInterval(id);
  }, [toast]);

  const launch = useCallback(() => {
    const title = name.trim() || `Projet ${jobsRef.current.length + 1}`;
    const q = quality === 'brouillon' ? 'Brouillon' : quality === 'final' ? 'Final' : 'Standard';
    setJobs((j) => [{ id: Date.now(), name: title, progress: 0, status: 'queue', quality: q }, ...j]);
    setPopup(false);
    setName('');
    toast({ title: 'Rendu lancé', description: `${title} · ${samples} échantillons`, tone: 'info' });
  }, [name, quality, samples, toast]);

  const active = jobs.find((j) => j.status === 'running');
  const p = active?.progress ?? 1;
  const nodes: DiagramNode[] = useMemo(
    () => [
      { id: 'scene', label: 'Scène', sub: 'USD · 14 plans', status: 'done' },
      { id: 'rays', label: 'Lancer de rayons', sub: `${Math.round(Math.min(1, p / 0.55) * 100)} %`, status: p < 0.55 ? 'active' : 'done' },
      { id: 'denoise', label: 'Débruitage', sub: 'GPU 2', status: p < 0.55 ? 'idle' : p < 0.8 ? 'active' : 'done' },
      { id: 'comp', label: 'Composition', sub: '16 bits', status: p < 0.8 ? 'idle' : p < 1 ? 'active' : 'done' },
      { id: 'export', label: 'Export', sub: 'EXR + MP4', status: p >= 1 ? 'done' : 'idle' },
    ],
    [p],
  );
  const links = useMemo(
    () => [
      { from: 'scene', to: 'rays', active: p < 0.55 },
      { from: 'rays', to: 'denoise', active: p >= 0.55 && p < 0.8 },
      { from: 'denoise', to: 'comp', active: p >= 0.8 && p < 1 },
      { from: 'comp', to: 'export', active: false },
    ],
    [p],
  );

  const running = jobs.filter((j) => j.status === 'running').length;
  const waiting = jobs.filter((j) => j.status === 'queue').length;
  const data = range === '7j' ? WEEK : MONTH;

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={(e) => e.preventDefault()} aria-label="Lumen, accueil">
          <span className="brand-mark" aria-hidden="true" />
          Lumen
        </a>
        <nav className="nav" aria-label="Navigation principale">
          <Button
            size="sm"
            variant="flat"
            as="a"
            href="/preferences"
            onClick={(e) => {
              e.preventDefault();
              router.push('/preferences');
            }}
          >
            Préférences
          </Button>
        </nav>
      </header>

      <section className="hero" aria-labelledby="titre">
        <div>
          <h1 id="titre">Console de rendu</h1>
          <p>Suivez la file, validez les versions et lancez un rendu depuis une seule surface.</p>
          <div className="stats" aria-label="Résumé">
            <div className="stat">
              <b className="mono">{running}</b>
              <span>en cours</span>
            </div>
            <div className="stat">
              <b className="mono">{waiting}</b>
              <span>en attente</span>
            </div>
            <div className="stat">
              <b className="mono">38 min</b>
              <span>rendu final moyen</span>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <Button ref={newBtn} glow={0.35} onClick={() => setPopup((o) => !o)} aria-haspopup="dialog" aria-expanded={popup}>
            Nouveau rendu
          </Button>
          <Menu
            label="Actions"
            items={[
              { label: 'Mettre la file en pause', hint: 'P', onSelect: () => toast({ title: 'File en pause', tone: 'warning' }) },
              { label: 'Exporter le journal', hint: 'E', onSelect: () => toast({ title: 'Journal exporté', description: 'rendus-2026.csv', tone: 'success' }) },
              { separator: true },
              { label: 'Vider la file', danger: true, onSelect: () => setJobs((j) => j.filter((x) => x.status === 'done')) },
            ]}
          />
        </div>
      </section>

      <Popup origin={newBtn} open={popup} onOpenChange={setPopup} radius={28} label="Nouveau rendu">
        <div className="pop">
          <h2>Nouveau rendu</h2>
          <TextField label="Projet" placeholder="Aurora — plan 15" value={name} onChange={(e) => setName(e.target.value)} />
          <Tabs
            label="Qualité"
            size="sm"
            items={[
              { value: 'brouillon', label: 'Brouillon' },
              { value: 'standard', label: 'Standard' },
              { value: 'final', label: 'Final' },
            ]}
            value={quality}
            onValueChange={setQuality}
          />
          <Slider label="Échantillons" min={64} max={2048} step={64} value={samples} onValueChange={setSamples} />
          <Switch label="Débruitage" checked={denoise} onCheckedChange={setDenoise} />
          <div className="pop-actions">
            <Button variant="flat" size="sm" onClick={() => setPopup(false)}>
              Annuler
            </Button>
            <Button size="sm" glow={0.35} onClick={launch}>
              Lancer le rendu
            </Button>
          </div>
        </div>
      </Popup>

      <div className="grid queue-row">
        <Surface className="panel" glow={0.25} radius={30} aria-labelledby="file">
          <div className="panel-head">
            <div>
              <h2 id="file">File de rendu</h2>
              <p className="sub">{jobs.length} rendus · mise à jour en direct</p>
            </div>
            {syncing ? (
              <Loader kind="blob" size="sm" label="Synchronisation en cours" />
            ) : (
              <Tooltip content="Synchroniser avec la ferme de rendu">
                <Button size="sm" variant="flat" onClick={sync}>
                  Synchroniser
                </Button>
              </Tooltip>
            )}
          </div>
          <div className="jobs" role="list">
            {jobs.map((j) => (
              <div className="job" role="listitem" key={j.id}>
                <div>
                  <div className="job-name">{j.name}</div>
                  <div className="job-meta">
                    {j.quality} · {j.status === 'done' ? 'terminé' : j.status === 'running' ? 'en cours' : 'en attente'}
                  </div>
                </div>
                <span className="pct mono" aria-hidden="true">
                  {j.status === 'queue' ? '—' : fmtPct(j.progress)}
                </span>
                {j.status !== 'queue' && (
                  <div className="job-bar">
                    <Loader kind="bar" size="sm" progress={j.progress} label={`Progression de ${j.name}`} style={{ width: '100%' }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Surface>

        <Surface className="panel" variant="flat" glow={0.2} radius={30}>
          <div className="panel-head">
            <h2>Répartition</h2>
          </div>
          <Chart type="donut" height={190} data={SPLIT} series={[{ key: 'part', name: 'Projets' }]} unit=" %" label="Répartition des projets" />
          <h2 style={{ marginTop: 6 }}>Charge GPU</h2>
          <Chart type="bar" height={150} data={LOAD} series={[{ key: 'charge', name: 'Charge' }]} unit=" %" label="Charge GPU par heure" />
        </Surface>
      </div>

      <Surface className="panel" variant="flat" glow={0.2} radius={30} style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <div>
            <h2>Pipeline</h2>
            <p className="sub">{active ? active.name : 'Aucun rendu en cours'}</p>
          </div>
        </div>
        <Diagram nodes={nodes} links={links} label="Pipeline de rendu" />
      </Surface>

      <Surface className="panel" variant="flat" glow={0.2} radius={30}>
        <div className="panel-head">
          <div>
            <h2>Activité</h2>
            <p className="sub">Rendus et heures GPU</p>
          </div>
          <Tabs
            size="sm"
            label="Période"
            items={[
              { value: '7j', label: '7 jours' },
              { value: '30j', label: '8 semaines' },
            ]}
            value={range}
            onValueChange={setRange}
          />
        </div>
        <Chart
          type="area"
          height={240}
          data={data}
          series={[
            { key: 'rendus', name: 'Rendus' },
            { key: 'gpu', name: 'Heures GPU' },
          ]}
          label="Activité"
        />
      </Surface>

      <h2 className="section-title">Projets</h2>
      <div className="projects">
        <Surface className="featured" glow={0.3} radius={34} aria-label="Projet à la une : Aurora">
          <div>
            <span className="tag">À valider</span>
            <h3 style={{ marginTop: 14 }}>Aurora</h3>
            <p className="sub" style={{ marginTop: 8, color: 'var(--lq-ink-soft)', maxWidth: '38ch' }}>
              Version 3 prête. La réfraction et le grain sont réglés ; il reste la fumée du plan 22.
            </p>
          </div>
          <div className="inline">
            <Button
              glow={0.35}
              onClick={() => {
                toast({ title: 'Version validée', description: 'Aurora · v3', tone: 'success' });
                drawer.open({ snapIndex: 0 });
              }}
            >
              Valider la version
            </Button>
            <Button variant="flat" onClick={() => drawer.open({ snapIndex: 1 })}>
              Commentaires
            </Button>
          </div>
        </Surface>

        <Surface className="row-list" variant="flat" glow={0.15} radius={28}>
          {projects.map((pr) => (
            <div className="proj" key={pr.id}>
              <span className="proj-dot" aria-hidden="true" />
              <div className="proj-main">
                <b>{pr.name}</b>
                <span>{pr.meta}</span>
              </div>
              <span className="tag">{pr.tag}</span>
              <Menu
                label={`Actions pour ${pr.name}`}
                size="sm"
                trigger={({ ref, onClick, ...aria }) => (
                  <Tooltip content={`Actions pour ${pr.name}`}>
                    <Button ref={ref} size="sm" variant="flat" onClick={onClick} {...aria} aria-label={`Actions pour ${pr.name}`}>
                      ···
                    </Button>
                  </Tooltip>
                )}
                items={[
                  { label: 'Ouvrir le projet', onSelect: () => toast({ title: `Ouverture de ${pr.name}`, tone: 'info' }) },
                  { label: 'Lancer le rendu', onSelect: () => setPopup(true) },
                  { separator: true },
                  { label: 'Supprimer le projet', danger: true, onSelect: () => setToDelete(pr) },
                ]}
              />
            </div>
          ))}
        </Surface>
      </div>

      <h2 className="section-title">Réglages rapides</h2>
      <div className="grid tools-row">
        <Surface className="panel" variant="flat" glow={0.2} radius={30}>
          <div className="form">
            <div className="form-row">
              <div>
                <h2>Rendu automatique</h2>
                <p className="sub">Lance le rendu à chaque nouvelle version validée.</p>
              </div>
              <Switch checked={auto} onCheckedChange={setAuto} aria-label="Rendu automatique" />
            </div>
            <Slider label="Priorité GPU" min={0} max={1} step={0.05} value={priority} onValueChange={setPriority} />
            <TextField label="Dossier de sortie" hint="Les images sont écrites au format EXR." value={folder} onChange={(e) => setFolder(e.target.value)} />
          </div>
        </Surface>
        <Surface className="panel" variant="flat" glow={0.2} radius={30}>
          <h2>Notifications</h2>
          <p className="sub">Testez les trois tons de notification et le tiroir de commentaires.</p>
          <div className="inline">
            <Tooltip content="Notification de succès">
              <Button size="sm" onClick={() => toast({ title: 'Rendu terminé', description: 'Lagune · 31 plans', tone: 'success' })}>
                Notifier un succès
              </Button>
            </Tooltip>
            <Button size="sm" variant="flat" onClick={() => toast({ title: 'Mémoire GPU presque pleine', description: 'GPU 2 · 94 %', tone: 'warning' })}>
              Notifier une alerte
            </Button>
            <Button size="sm" variant="flat" onClick={() => toast({ title: 'Échec du rendu', description: 'Texture introuvable', tone: 'danger' })}>
              Notifier une erreur
            </Button>
            <Button size="sm" variant="flat" onClick={() => drawer.open({ snapIndex: 0 })}>
              Commentaires
            </Button>
          </div>
        </Surface>
      </div>

      <Alert
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        tone="danger"
        title={toDelete ? `Supprimer le projet « ${toDelete.name} » ?` : 'Supprimer le projet ?'}
        actions={[
          { label: 'Annuler', autoFocus: true },
          {
            label: 'Supprimer le projet',
            tone: 'danger',
            onClick: () => {
              if (toDelete) {
                setProjects((l) => l.filter((x) => x.id !== toDelete.id));
                toast({ title: 'Projet supprimé', description: toDelete.name, tone: 'danger' });
              }
            },
          },
        ]}
      >
        Les plans, les rendus et les commentaires seront supprimés. Cette action est définitive.
      </Alert>

      <Drawer side="bottom" snap={[35, 70, 95]} label="Commentaires">
        <div className="drawer-head">
          <h2>Commentaires</h2>
          <span className="sub mono" style={{ color: 'var(--lq-ink-soft)', fontSize: 13 }}>
            {COMMENTS.length} messages
          </span>
        </div>
        <div className="comments">
          {COMMENTS.map((c, i) => (
            <div className="comment" key={i}>
              <span className="avatar" aria-hidden="true">
                {c.who
                  .split(' ')
                  .map((w) => w[0])
                  .join('')}
              </span>
              <div>
                <b>{c.who}</b>
                <small>{c.t}</small>
                <p>{c.text}</p>
              </div>
            </div>
          ))}
          <TextField label="Votre commentaire" placeholder="Écrire un commentaire…" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="inline">
            <Button
              onClick={() => {
                setComment('');
                toast({ title: 'Commentaire publié', tone: 'success' });
              }}
              disabled={!comment.trim()}
            >
              Publier le commentaire
            </Button>
          </div>
        </div>
      </Drawer>
    </main>
  );
}
