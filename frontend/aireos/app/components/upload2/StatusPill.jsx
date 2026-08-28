// Small status badge. Variants map to the project's success / warning / error
// palette plus violet accents. Pure presentational primitive.
const VARIANTS = {
  ok: 'bg-green-50 text-green-700 border-green-200',
  pending: 'bg-yellow-50 text-yellow-800 border-yellow-300',
  bad: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-lavander text-deep-violet-blue border-violet',
  mute: 'bg-cream text-deep-violet-blue/70 border-lavander',
};

export default function StatusPill({ variant = 'mute', mono = false, children }) {
  const classes = VARIANTS[variant] || VARIANTS.mute;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        mono ? 'font-mono' : ''
      } ${classes}`}
    >
      {children}
    </span>
  );
}