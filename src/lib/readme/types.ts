export interface DocumentationItem {
  name: string;
  description: string;
  category: string;
  path: string;
  version?: string;
  usage?: string;
}

export interface Parser {
  parse(): Promise<DocumentationItem[]>;
}
