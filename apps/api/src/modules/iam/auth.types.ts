export interface JwtPayload {
  sub: string; // userId
  roles: string[];
  orgId?: string;
  orgCode?: string;
  partyType?: string;
}
