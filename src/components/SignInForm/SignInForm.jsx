import { useContext } from "react";
import { useNavigate } from "react-router";
import { signIn } from "../../services/authService";
import { UserContext } from "../../contexts/UserContext";
import LoginIcon from "../../assets/images/login.svg";
import styles from "./SignInForm.module.css";
import { useAuthForm } from "../../hooks/useAuthForm";
import AuthFormShell from "../AuthFormShell/AuthFormShell";

const SignInForm = () => {
  const navigate = useNavigate();
  const { setUser } = useContext(UserContext);
  const { message, setMessage, formData, handleChange } = useAuthForm({
    username: "",
    password: "",
  });

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    try {
      const signedInUser = await signIn(formData);
      setUser(signedInUser);
      navigate("/");
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <AuthFormShell
      className={styles.container}
      iconSrc={LoginIcon}
      iconAlt="An owl sitting on a sign"
      title="Sign In"
      message={message}
      onSubmit={handleSubmit}
    >
      <div>
        <label htmlFor="username">Username:</label>
        <input
          type="text"
          autoComplete="off"
          id="username"
          value={formData.username}
          name="username"
          onChange={handleChange}
          required
        />
      </div>
      <div>
        <label htmlFor="password">Password:</label>
        <input
          type="password"
          autoComplete="off"
          id="password"
          value={formData.password}
          name="password"
          onChange={handleChange}
          required
        />
      </div>
      <div>
        <button>Sign In</button>
        <button type="button" onClick={() => navigate("/")}>
          Cancel
        </button>
      </div>
    </AuthFormShell>
  );
};

export default SignInForm;
