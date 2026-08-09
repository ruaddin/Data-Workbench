import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import MainPage from "@/pages/MainPage/MainPage";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MainPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
