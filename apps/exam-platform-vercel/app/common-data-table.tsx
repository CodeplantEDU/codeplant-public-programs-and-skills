import type { CommonReference } from "../lib/exam";
import { RichText } from "./rich-text";

type Props = {
  table: CommonReference["table"];
  className?: string;
};

export function CommonDataTable({ table, className = "" }: Props) {
  if (table.columns.length === 0) return null;
  return (
    <div className={`table-wrap common-data-table ${className}`.trim()}>
      <table>
        <thead><tr>{table.columns.map((column, index) => <th scope="col" key={`${index}-${column}`}><RichText text={column} /></th>)}</tr></thead>
        {table.rows.length > 0 && <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{table.columns.map((_, columnIndex) => <td key={columnIndex}><RichText text={row[columnIndex] ?? ""} /></td>)}</tr>)}</tbody>}
      </table>
    </div>
  );
}
