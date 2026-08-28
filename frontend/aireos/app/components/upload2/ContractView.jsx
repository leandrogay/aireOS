import ColumnName from './ColumnName';
import MeltGroup from './MeltGroup';

// Renders a mapping contract: warnings, direct renames (identity_mapping), and
// melt groups. Shared by upload results, the confirmed outcome, and lookup.
export default function ContractView({ contract }) {
  const warnings = contract.warnings || [];
  const identityMapping = contract.identity_mapping || {};
  const renameKeys = Object.keys(identityMapping);
  const meltGroups = contract.melt_groups || [];

  return (
    <div>
      {warnings.length > 0 && (
        <div className="mb-3 rounded-md border-l-4 border-yellow-400 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
          <strong>{warnings.length} item(s) dropped or unmapped</strong>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mb-1 mt-3 font-mono text-[10px] font-bold uppercase tracking-wider text-deep-violet-blue/60">
        Direct renames ({renameKeys.length})
      </p>
      {renameKeys.length === 0 ? (
        <p className="text-sm text-deep-violet-blue/60">None.</p>
      ) : (
        <table className="mb-1 w-full border-collapse">
          <tbody>
            {renameKeys.map((key) => (
              <tr key={key} className="border-b border-lavander last:border-b-0">
                <td className="py-1.5 pr-2 align-top">
                  <ColumnName value={key} />
                </td>
                <td className="w-6 py-1.5 text-center align-top text-violet">→</td>
                <td className="w-1/3 py-1.5 align-top font-mono text-green-700">
                  {identityMapping[key]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mb-1 mt-4 font-mono text-[10px] font-bold uppercase tracking-wider text-deep-violet-blue/60">
        Melt groups ({meltGroups.length})
      </p>
      {meltGroups.length === 0 ? (
        <p className="text-sm text-deep-violet-blue/60">None.</p>
      ) : (
        meltGroups.map((group, index) => <MeltGroup key={index} group={group} />)
      )}
    </div>
  );
}