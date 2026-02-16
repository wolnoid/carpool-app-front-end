import { useContext } from 'react';
import { Link } from 'react-router';
import { UserContext } from '../../contexts/UserContext';
import { clearToken } from "../../services/tokenService";
import styles from './NavBar.module.css';
import Logo from '../../assets/images/logo1.png';

const NavBar = () => {
  const { user, setUser } = useContext(UserContext);

  const handleSignOut = () => {
    clearToken();
    setUser(null);
  };

  return (
    <nav className={styles.container}>
      <Link to='/'><img src={Logo} alt='A cute owl' /></Link>
      {user ? (
        <ul>
          <li><Link to='/'>My Profile</Link></li>
          <li><Link to='/' onClick={handleSignOut}>Sign Out</Link></li>
        </ul>
      ) : (
        <ul>
          <li><Link to='/sign-up'>Sign Up</Link></li>
          <li><Link to='/sign-in'>Sign In</Link></li>
        </ul>
      )}
    </nav>
  );
};

export default NavBar;
