// WordPress Post Types
export interface Post {
  id: string;
  databaseId: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  date: string;
  modified: string;
  author: {
    node: Author;
  };
  featuredImage?: FeaturedImage;
  categories?: {
    nodes: Category[];
  };
  tags?: {
    nodes: Tag[];
  };
  commentCount?: number;
  comments?: {
    nodes: Comment[];
  };
}

export interface Author {
  id: string;
  name: string;
  slug: string;
  avatar?: {
    url: string;
  };
  description?: string;
}

export interface FeaturedImage {
  node: {
    id: string;
    sourceUrl: string;
    altText: string;
    mediaDetails?: {
      width: number;
      height: number;
    };
  };
}

export interface Category {
  id: string;
  name: string;
  slug: string;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
}

export interface Comment {
  id: string;
  content: string;
  date: string;
  author: {
    node: {
      name: string;
      email?: string;
      avatar?: {
        url: string;
      };
    };
  };
  parent?: {
    node: {
      id: string;
    };
  };
}

// Pagination
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface PostConnection {
  nodes: Post[];
  pageInfo: PageInfo;
}
