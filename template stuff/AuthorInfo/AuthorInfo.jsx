// src/components/AuthorInfo/AuthorInfo.jsx

import styles from './AuthorInfo.module.css';
import ProfileIcon from '../../assets/images/profile.png';
import Icon from '../Icon/Icon';

const AuthorInfo = ({ content }) => {
  return (
    <div className={styles.container}>
      <img
        src={ProfileIcon}
        alt="The user's avatar"
      />
      <section>
        <p>{content.author.username}</p>
        <div className={styles.container}>
          <Icon category='Calendar' />
          <p>{new Date(content.createdAt).toLocaleDateString()}</p>
        </div>
      </section>
    </div>
  );
};

export default AuthorInfo;
