import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import * as hootService from '../../services/hootService';
import styles from './CommentForm.module.css';
import Icon from '../Icon/Icon';

const CommentForm = (props) => {
  const { hootId, commentId } = useParams();
  const [formData, setFormData] = useState({ text: '' });
  const navigate = useNavigate();

  useEffect(() => {
    const fetchHoot = async () => {
      const hootData = await hootService.show(hootId);
      
      setFormData(hootData.comments.find((comment) => comment._id === commentId));
    };
    if (hootId && commentId) fetchHoot();
  }, [hootId, commentId]);

  const handleChange = (evt) => {
    setFormData({ ...formData, [evt.target.name]: evt.target.value });
  };

  const handleSubmit = (evt) => {
    evt.preventDefault();
    if (hootId && commentId) {
      hootService.updateComment(hootId, commentId, formData);
      navigate(`/hoots/${hootId}`);
    } else {
      props.handleAddComment(formData);
    }
    setFormData({ text: '' });
  };

  if (hootId && commentId) return (
    <main className={styles.container}>
      <form onSubmit={handleSubmit}>
        <h1>Edit Comment</h1>
        <label htmlFor='text-input'>Your comment:</label>
        <textarea
          required
          type='text'
          name='text'
          id='text-input'
          value={formData.text}
          onChange={handleChange}
        />
        <button type='submit'>
          <Icon category='Create' />
        </button>
      </form>
    </main>
  );

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor='text-input'>Your comment:</label>
      <textarea
        required
        type='text'
        name='text'
        id='text-input'
        value={formData.text}
        onChange={handleChange}
      />
      <button type='submit'>SUBMIT COMMENT</button>
    </form>
  );
};

export default CommentForm;

