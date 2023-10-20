import Editor from "./Editor.js";
import Sidebar from "./Sidebar.js";
import router from "./router.js";
import { asyncDataObj, request } from "./api.js";
import { setItem, getItem, removeItem } from "./storage.js";
import { getLocalSaveKey } from "./utility.js";

export default function App({ targetEl }) {
  this.isInit = false;

  this.state = {
    selectedDocumentId: null,
    documents: { ...asyncDataObj, isLoading: true },
    document: { ...asyncDataObj },
  };

  this.setState = (nextState) => {
    const prevState = { ...this.state };

    if (JSON.stringify(prevState) !== JSON.stringify(nextState)) {
      this.state = nextState;

      sidebar.setState({
        selectedDocumentId: this.state.selectedDocumentId,
        documents: this.state.documents,
      });

      editor.setState({
        selectedDocumentId: this.state.selectedDocumentId,
        document: this.state.document,
      });

      this.render();
    }
  };

  let serverUpdateTimer = null;
  let localSaveTimer = null;

  const sidebar = new Sidebar({
    targetEl,
    initialState: {
      selectedDocumentId: this.state.selectedDocumentId,
      documents: this.state.documents,
    },
    onCreate: async (parent) => {
      const res = await createDocument(parent);

      await fetchDocuments();

      if (res.id) {
        router.push(`/documents/${res.id}`);
      } else {
        throw new Error("문서 생성 과정에서 에러가 발생하였습니다!");
      }
    },
    onDelete: async (id) => {
      const res = await deleteDocument(id);
      router.replace(res.parent?.id ? `/documents/${res.parent.id}` : "/");
      await fetchDocuments();
    },
  });

  const editor = new Editor({
    targetEl,
    initialState: {
      selectedDocumentId: this.state.selectedDocumentId,
      document: this.state.document,
    },
    onEditing: (document) => {
      clearTimeout(serverUpdateTimer);
      clearTimeout(localSaveTimer);
      serverUpdateTimer = setTimeout(async () => {
        await updateDocument(document);

        const LOCAL_SAVE_KEY = getLocalSaveKey(document.id);
        removeItem(LOCAL_SAVE_KEY);

        await fetchDocument(document.id);

        await fetchDocuments();
      }, 3000);
      localSaveTimer = setTimeout(async () => {
        localSaveDocument(document);
      }, 250);
    },
  });

  const fetchDocuments = async () => {
    try {
      const res = await request("/documents");
      this.setState({
        ...this.state,
        documents: { ...asyncDataObj, data: res },
      });
    } catch (e) {
      this.setState({
        ...this.state,
        documents: { ...asyncDataObj, isError: e },
      });
    }
  };

  const fetchDocument = async (id) => {
    if (id === null) {
      this.setState({
        ...this.state,
        document: { ...asyncDataObj },
      });
      return null;
    }

    const LOCAL_SAVE_KEY = getLocalSaveKey(id);
    const storedData = getItem(LOCAL_SAVE_KEY, false);

    try {
      const res = await request(`/documents/${id.toString()}`);

      const savedAt = new Date(storedData.localSaveDate).getTime();
      const updatedAt = new Date(res.updatedAt).getTime();

      if (
        savedAt > updatedAt &&
        window.confirm("로컬에 저장된 최신 정보가 있습니다. 가져오시겠습니까?")
      ) {
        delete storedData.localSaveDate;

        this.setState({
          ...this.state,
          document: { ...asyncDataObj, data: storedData },
        });
      } else {
        this.setState({
          ...this.state,
          document: { ...asyncDataObj, data: res },
        });
      }

      this.setState({
        ...this.state,
        document: {
          ...asyncDataObj,
          data: savedAt > updatedAt ? storedData : res,
        },
      });
    } catch (e) {
      this.setState({
        ...this.state,
        document: { ...asyncDataObj, isError: e },
      });
    }
  };

  const updateDocument = async (document) => {
    const { id, title, content } = document;

    const body = { title, content };

    const res = await request(`/documents/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return res;
  };

  const createDocument = async (parent) => {
    const body = { title: "제목 없음", parent };

    const res = await request(`/documents`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return res;
  };

  const deleteDocument = async (id) => {
    // if (!id || typeof id !== "number") {
    //   throw new Error("삭제할 문서의 id를 입력하세요!");
    // }

    const res = await request(`/documents/${id}`, { method: "DELETE" });

    return res;
  };

  const localSaveDocument = async (document) => {
    if (
      this.state.document.data.id === document.id &&
      (this.state.document.data.title !== document.title ||
        this.state.document.data.content !== document.content)
    ) {
      const LOCAL_SAVE_KEY = getLocalSaveKey(document.id);
      setItem(LOCAL_SAVE_KEY, { ...document, localSaveDate: new Date() });
    }
  };

  const onRouterChange = (pathname) => {
    const arr = pathname.substring(1).split("/");
    const id = arr.length > 1 ? Number(arr[1]) : null;

    if (this.state.selectedDocumentId !== id) {
      this.setState({
        ...this.state,
        selectedDocumentId: id,
      });
      fetchDocument(id);
    }

    clearTimeout(serverUpdateTimer);
    clearTimeout(localSaveTimer);
  };

  this.render = () => {
    if (!this.isInit) {
      router.init(onRouterChange);
      onRouterChange(window.location.pathname);

      sidebar.render();
      editor.render();

      fetchDocuments();

      this.isInit = true;
    }
  };

  this.render();
}
