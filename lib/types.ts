
export type Review = {
  id: number;
  text: string;
  rating: string;
  date: string;
  option: string;
  sponsored: boolean;
};

export type Result = {
  id: number;
  theme: string;
  subtheme: string;
  sentiment: string;
  evidence: string;
};

export type Theme = {
  name: string;
  description?: string;
};

export type ColumnMapping = {
  text: number;
  rating: number;
  date: number;
  option: number;
};
