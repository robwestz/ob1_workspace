import chalk from 'chalk';

export function statusIcon(ok: boolean): string {
  return ok ? chalk.green('\u25cf') : chalk.red('\u25cb');
}

export function header(text: string): void {
  console.log(chalk.bold.cyan(`\n  ${text}\n`));
}

export function table(headers: string[], rows: string[][]): void {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, maxRow);
  });

  // Print header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(chalk.bold(`  ${headerLine}`));

  // Print separator
  const separator = widths.map(w => '\u2500'.repeat(w)).join('  ');
  console.log(chalk.gray(`  ${separator}`));

  // Print rows
  for (const row of rows) {
    const line = row.map((cell, i) => cell.padEnd(widths[i])).join('  ');
    console.log(`  ${line}`);
  }
}

export function success(msg: string): void {
  console.log(chalk.green(`  \u2713 ${msg}`));
}

export function warn(msg: string): void {
  console.log(chalk.yellow(`  \u26a0 ${msg}`));
}

export function error(msg: string): void {
  console.log(chalk.red(`  \u2717 ${msg}`));
}

export function info(msg: string): void {
  console.log(chalk.gray(`  ${msg}`));
}

export function divider(): void {
  console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
}
