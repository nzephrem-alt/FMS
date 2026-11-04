import { Search, Bell, Menu, ChevronDown } from 'lucide-react';
type Props = { active: string; search: string; setSearch: (value: string) => void; onMenu: () => void };
export default function Header({ active, search, setSearch, onMenu }: Props) {
 const title = active === 'Dashboard' ? 'Dashboard overview' : active;
 return <header className="topbar"><div className="topbar-left"><button className="menu-toggle" onClick={onMenu}><Menu size={21}/></button><div className="breadcrumb">Financial Management System <span>/</span> <strong>{title}</strong></div></div><div className="topbar-right"><label className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." /></label><button className="icon-button notification"><Bell size={18}/><i/></button><div className="top-user"><div className="avatar small">MD</div><ChevronDown size={15}/></div></div></header>;
}
