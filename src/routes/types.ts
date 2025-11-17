export interface Types {
  height?: number;
  width?: number;
  type?: string;
  url: string;
  alt?: string;
}

export interface UrlResource {
  id: string;
  url: string;
  domain?: string;
  title?: string;
  content_type?: string;
  description?: string;
  image?: Types[];
  created_at: string;
  true_count?: number;
  false_count?: number;
  else_count?: number;
  verified_true_count?: number;
  verified_false_count?: number;
  verified_else_count?: number;
}

export interface ClaimerResource {
  id: string;
  id_token: string;
  icon?: string;
  organization?: string;
  created_at: string;
}

export interface ClaimResource {
  id: string;
  url: UrlResource;
  claimer: ClaimerResource;
  comment: string;
  created_at: string;
}
