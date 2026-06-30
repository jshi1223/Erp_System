export type UserRole = 'super_admin' | 'admin' | 'staff' | 'user';

export interface MeResponse {
  loggedIn: boolean;
  id?: string | number;
  username?: string;
  fullname?: string;
  email?: string;
  role?: UserRole;
  csrfToken?: string;
}

export interface BusinessEntity {
  id: number;
  entity_code?: string;
  company_name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  tin?: string;
  address?: string;
  status?: string;
  is_default?: boolean | number;
  logo_path?: string;
}

export interface CompanyRegistry {
  id: number;
  company_no?: string;
  branch_code?: string;
  company_name: string;
  tin?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  industry?: string;
  status?: string;
  notes?: string;
  archived?: boolean | number;
  vendor_profile_id?: number | null;
  vendor_profile_no?: string | null;
  vendor_profile_name?: string | null;
  vendor_profile_active?: boolean | number;
}

export interface Vendor {
  id: number;
  vendor_no?: string;
  vendor_name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  tin?: string;
  is_active?: boolean | number;
  company_id?: number | null;
  company_no?: string;
  company_name?: string;
}

export interface CompanyOverview {
  company: { id: number; company_no?: string; company_name: string; status?: string; archived?: boolean | number };
  counts: {
    project_count: number;
    active_project_count: number;
    completed_project_count: number;
    purchase_order_count: number;
    vendor_count: number;
    receivable_count: number;
  };
  vendor_profile: { id: number; vendor_no?: string; vendor_name?: string; is_active?: boolean | number } | null;
  recent_projects: Array<{ id: number; project_docno?: string; project_name?: string; status?: string }>;
}

export interface Receivable {
  id: number;
  invoice_number?: string;
  customer_name?: string;
  sales_document_no?: string;
  source_sales_order_no?: string;
  project_docno?: string;
  invoice_date?: string;
  due_date?: string;
  payment_terms?: string;
  total_amount?: number;
  paid_amount?: number;
  status?: string;
  archived?: boolean | number;
}

export interface ArPayment {
  id: number;
  ar_id?: number;
  payment_date?: string;
  amount?: number;
  payment_method?: string;
  reference_number?: string;
  notes?: string;
  approval_status?: string;
  invoice_number?: string;
  customer_name?: string;
}

export interface Product {
  id: number;
  sku?: string;
  product_name: string;
  category?: string;
  unit?: string;
  reorder_level?: number;
  unit_cost?: number;
  selling_price?: number;
  quantity_on_hand?: number;
}

export interface Warehouse {
  id: number;
  warehouse_code?: string;
  warehouse_name: string;
  location?: string;
}

export interface StockRow {
  id: number;
  product_id?: number;
  warehouse_id?: number;
  sku?: string;
  product_name?: string;
  category?: string;
  unit?: string;
  reorder_level?: number;
  warehouse_code?: string;
  warehouse_name?: string;
  quantity_on_hand?: number;
}

export interface Movement {
  id: number;
  movement_date?: string;
  movement_type?: string;
  quantity?: number;
  sku?: string;
  product_name?: string;
  warehouse_code?: string;
  warehouse_name?: string;
  reference_type?: string;
  reference_no?: string;
  project_docno?: string;
  project_name?: string;
}

export interface ManagedUser {
  id: number;
  username?: string;
  fullname?: string;
  email?: string;
  role?: UserRole;
  active?: boolean | number;
  approval_status?: string;
  approved_at?: string;
  approved_by_username?: string;
  approved_by_fullname?: string;
  last_login?: string;
  created_at?: string;
}
