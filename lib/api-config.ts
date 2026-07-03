// Endpoints centralizados para facilitar o teste sem alterar código.
// Estes caminhos são anexados às Base URLs configuradas no backend.

export const DEFAULT_ENDPOINTS = {
  vesti: {
    test: "/v2/products/company/{company_id}?start_date=2016-01-01%2000:00:00&end_date=2016-01-01%2023:59:59&perpage=1&page=1",
    categories: "/v1/categories/company/{company_id}",
    products: "/v2/products/company/{company_id}",
  },
  upzero: {
    test: "/external/v1/categories",
    categories: "/external/v1/categories",
    internalCategories: "/external/v1/internal-categories",
    products: "/external/v1/products",
  },
}

export type EndpointConfig = typeof DEFAULT_ENDPOINTS

export type ApiProvider = "vesti" | "upzero"
