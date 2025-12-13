import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export interface Row {
  chars: string;
  top: number;
  bottom: number;
  offsets: number[];
}

export interface FontMetadata {
  name: string;
  rows: Row[];
  word_spacing?: number;
}

export interface CharMetadata {
  char: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(__dirname, "../static/fonts");

export class Font {
  private metadata: FontMetadata;
  private font_lines: string[];
  private char_cache: Map<string, CharMetadata>;

  constructor(font_name: string) {
    const base_path = join(FONTS_DIR, font_name);

    // Load metadata
    const metadata_path = `${base_path}.json`;
    this.metadata = JSON.parse(readFileSync(metadata_path, "utf-8"));

    // Load font file
    const font_path = `${base_path}.txt`;
    this.font_lines = readFileSync(font_path, "utf-8").split("\n");

    // Build character cache
    this.char_cache = new Map();
    for (const row of this.metadata.rows) {
      for (let i = 0; i < row.chars.length; i++) {
        const char = row.chars[i];
        this.char_cache.set(char, {
          char,
          top: row.top,
          bottom: row.bottom,
          left: row.offsets[i],
          right: row.offsets[i + 1] - 1,
        });
      }
    }
  }

  get height(): number {
    if (this.metadata.rows.length === 0) return 0;
    return Math.max(...this.metadata.rows.map(row => row.bottom - row.top + 1));
  }

  get_char(char: string): CharMetadata | undefined {
    return this.char_cache.get(char);
  }

  render_char(char: string): string[] {
    const meta = this.get_char(char);
    if (!meta) {
      return new Array(this.height).fill("");
    }

    const result: string[] = [];
    for (let row = meta.top; row <= meta.bottom && row < this.font_lines.length; row++) {
      const line = this.font_lines[row] || "";
      result.push(line.slice(meta.left, meta.right + 1));
    }

    return result;
  }

  render(text: string, spacing: number = 1): string[] {
    const word_spacing = this.metadata.word_spacing ?? 8;
    if (!text) {
      return new Array(this.height).fill("");
    }

    const result: string[] = new Array(this.height).fill("");

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === ' ') {
        for (let line_idx = 0; line_idx < this.height; line_idx++) {
          result[line_idx] += " ".repeat(word_spacing);
        }
        continue;
      }

      const char_lines = this.render_char(char);

      for (let line_idx = 0; line_idx < this.height; line_idx++) {
        const char_line = char_lines[line_idx] || "";
        result[line_idx] += char_line;

        if (i < text.length - 1 && text[i + 1] !== ' ') {
          result[line_idx] += " ".repeat(spacing);
        }
      }
    }

    return result;
  }

  render_to_string(text: string, spacing: number = 1): string {
    return this.render(text, spacing).join("\n");
  }

  has_char(char: string): boolean {
    return this.char_cache.has(char);
  }
}
